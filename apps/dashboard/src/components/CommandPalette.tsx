import { Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { Api, ClaimSummary } from "../api";
import { claimHref, QUEUE_HREF } from "../useHashRoute";

interface Command {
  id: string;
  label: string;
  hint: string;
  // Where it goes, or null to sign out.
  href: string | null;
}

interface CommandPaletteProps {
  api: Api;
  onSignOut: () => void;
}

/** The commands matching what's typed: the queue and sign-out, then up to eight claims by
 * number, customer or what happened. */
export function commandsFor(claims: ClaimSummary[], query: string): Command[] {
  const wanted = query.trim().toLowerCase();
  const matches = (text: string) => !wanted || text.toLowerCase().includes(wanted);
  const fixed: Command[] = [
    { id: "queue", label: "Go to the queue", hint: "U", href: QUEUE_HREF },
    { id: "sign-out", label: "Sign out", hint: "", href: null },
  ];
  const found = claims
    .filter((claim) => [claim.claim_id, claim.customer_name, claim.summary].some(matches))
    .slice(0, 8)
    .map((claim) => ({
      id: claim.claim_id,
      label: `${claim.claim_id} · ${claim.customer_name}`,
      hint: claim.summary,
      href: claimHref(claim.claim_id),
    }));
  return [...fixed.filter((command) => matches(command.label)), ...found];
}

/** Ctrl+K or ⌘K: jump to a claim or run a command. Escape closes it. */
export function CommandPalette({ api, onSignOut }: CommandPaletteProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [claims, setClaims] = useState<ClaimSummary[]>([]);
  const [active, setActive] = useState(0);
  const ids = useId();
  const commands = commandsFor(claims, query);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      if (dialog.current?.open) return;
      setQuery("");
      setActive(0);
      dialog.current?.showModal();
      input.current?.focus();
      api.listClaims().then(setClaims, () => {
        setClaims([]);
      });
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [api]);

  function choose(command: Command | undefined) {
    if (!command) return;
    dialog.current?.close();
    if (command.href === null) onSignOut();
    else window.location.hash = command.href;
  }

  return (
    <dialog ref={dialog} className="palette" aria-label="Go to a claim or run a command">
      <label htmlFor={`${ids}-input`} className="palette-search">
        <Search size={18} strokeWidth={2} aria-hidden="true" />
        <span className="visually-hidden">Claim number, customer or command</span>
        <input
          ref={input}
          id={`${ids}-input`}
          placeholder="Claim number, customer or command"
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") setActive((at) => Math.min(at + 1, commands.length - 1));
            else if (event.key === "ArrowUp") setActive((at) => Math.max(at - 1, 0));
            else if (event.key === "Enter") choose(commands[active]);
            else return;
            event.preventDefault();
          }}
        />
      </label>
      <ul className="palette-list">
        {commands.map((command, index) => (
          <li key={command.id}>
            <button
              type="button"
              className={index === active ? "active" : undefined}
              aria-current={index === active ? "true" : undefined}
              onClick={() => {
                choose(command);
              }}
            >
              <span>{command.label}</span>
              <span className="muted small">{command.hint}</span>
            </button>
          </li>
        ))}
        {commands.length === 0 && <li className="muted">Nothing matches.</li>}
      </ul>
    </dialog>
  );
}
