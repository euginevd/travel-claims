import { Download, Lock, Search, ShieldAlert } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import type { Api, AuditEntry, ChainStatus } from "../api";
import { TableScroll } from "../components/TableScroll";
import { useFocusHeading } from "@undercover/web-core/useFocusHeading";

const KINDS: { key: AuditEntry["kind"] | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "switch", label: "Switches" },
  { key: "setting", label: "Settings" },
  { key: "decision", label: "Decisions" },
  { key: "version", label: "Versions" },
  { key: "evaluation", label: "Evaluation set" },
  { key: "reset", label: "Resets" },
];

/** The newest first, 20 at a time, so the log stays short. */
const PAGE = 20;

const CHIPS: Record<AuditEntry["kind"], string> = {
  switch: "chip",
  setting: "chip",
  decision: "chip chip-info",
  version: "chip chip-good",
  evaluation: "chip chip-info",
  reset: "chip chip-warn",
};

const dayFormat = new Intl.DateTimeFormat("en-AU", {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const timeFormat = new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit" });

/** "Today · Fri 13 Nov", "Yesterday · Thu 12 Nov" or "Wed 11 Nov", by the engineer's clock. */
function dayOf(at: string, now: Date): string {
  const then = new Date(at);
  if (Number.isNaN(then.getTime())) return at;
  const days = Math.round(
    (new Date(now.toDateString()).getTime() - new Date(then.toDateString()).getTime()) / 86_400_000,
  );
  const date = dayFormat.format(then);
  return days === 0 ? `Today · ${date}` : days === 1 ? `Yesterday · ${date}` : date;
}

function timeOf(at: string): string {
  const then = new Date(at);
  return Number.isNaN(then.getTime()) ? "" : timeFormat.format(then);
}

/** What happened, as a sentence: "Agent switched off", "Payouts paused". */
function sentence(entry: AuditEntry): string {
  if (entry.kind === "decision") return `Decided ${entry.change}`;
  if (entry.label === "Agent switch") return `Agent switched ${entry.change}`;
  if (entry.label === "Payouts") {
    return entry.change === "live" ? "Payouts made live" : "Payouts paused";
  }
  return entry.change.charAt(0).toUpperCase() + entry.change.slice(1);
}

/** The rows shown, as CSV for an auditor: one quoted field each, quotes doubled. A field a
 * spreadsheet would run as a formula (a reason starting "=", "+", "-" or "@") gets a leading
 * apostrophe, so opening the file never evaluates what a handler or a model wrote. */
export function auditCsv(entries: AuditEntry[]): string {
  const cell = (value: string | null) => {
    const text = value ?? "";
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows = entries.map((e) =>
    [e.at, e.kind, e.label, sentence(e), e.reason, e.by].map(cell).join(","),
  );
  return ["at,kind,what,change,reason,by", ...rows].join("\n");
}

/** Govern · Audit log: who changed what, and why, from the records the api keeps. */
export function AuditPage({ api }: { api: Api }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<AuditEntry["kind"] | "all">("all");
  const [query, setQuery] = useState("");
  const [who, setWho] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [chain, setChain] = useState<ChainStatus | null>(null);
  // The seal check failed to run: said on the page, as a missing line would read as "sealed".
  const [unchecked, setUnchecked] = useState(false);

  useEffect(() => {
    let live = true;
    api.getAuditChain().then(
      (found) => {
        if (live) setChain(found);
      },
      () => {
        if (live) setUnchecked(true);
      },
    );
    return () => {
      live = false;
    };
  }, [api]);
  const heading = useFocusHeading();

  useEffect(() => {
    let live = true;
    api.getAudit().then(
      (found) => {
        if (live) setEntries(found);
      },
      (caught: unknown) => {
        if (live) setError(caught instanceof Error ? caught.message : String(caught));
      },
    );
    return () => {
      live = false;
    };
  }, [api]);

  const words = query.trim().toLowerCase();
  const shown =
    entries?.filter(
      (entry) =>
        (kind === "all" || entry.kind === kind) &&
        (!who || entry.by === who) &&
        (!words ||
          [entry.label, sentence(entry), entry.reason ?? "", entry.by]
            .join(" ")
            .toLowerCase()
            .includes(words)),
    ) ?? [];
  const people = [...new Set((entries ?? []).map((entry) => entry.by))].sort();
  const now = new Date();
  // The page's rows under their day, newest first.
  const days: { day: string; rows: AuditEntry[] }[] = [];
  for (const entry of shown.slice(0, limit)) {
    const day = dayOf(entry.at, now);
    const last = days[days.length - 1];
    if (last?.day === day) last.rows.push(entry);
    else days.push({ day, rows: [entry] });
  }
  return (
    <section className="view page-in" aria-labelledby="audit-heading">
      <header className="page-head">
        <div>
          <p className="eyebrow">Govern · Audit log</p>
          <h1 id="audit-heading" ref={heading} tabIndex={-1}>
            Who changed what, and why
          </h1>
          <p className="lede">
            Every switch, setting, override, reset, version and evaluation-set addition. Read-only, and
            sealed: each entry&apos;s SHA-256 digest is chained to the one before, so a record changed
            afterwards shows.
          </p>
        </div>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {entries && (
        <>
          {unchecked && (
            <p className="audit-chain is-broken" role="alert">
              <ShieldAlert size={15} strokeWidth={1.75} aria-hidden="true" />
              Couldn&apos;t check the seals, so these entries aren&apos;t verified. Reload to try
              again.
            </p>
          )}
          {chain && (
            <p className={chain.intact ? "audit-chain" : "audit-chain is-broken"}>
              {chain.intact ? (
                <Lock size={15} strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <ShieldAlert size={15} strokeWidth={1.75} aria-hidden="true" />
              )}
              {chain.intact
                ? `${String(chain.sealed)} entries sealed in a SHA-256 hash chain · intact${chain.anchored ? " · copied to write-once storage" : ""}`
                : `${
                    chain.changed.length + chain.missing.length
                      ? `Changed after sealing: ${[...chain.changed, ...chain.missing].join(", ")}`
                      : "The seals don't match their write-once copy"
                  }${
                    chain.broken_at === null
                      ? ""
                      : ` · chain broken at seal ${String(chain.broken_at)}`
                  }`}
            </p>
          )}
          <div className="audit-tools">
            <div className="audit-filters" role="group" aria-label="Show">
              {KINDS.map((option) => {
                const count =
                  option.key === "all"
                    ? entries.length
                    : entries.filter((entry) => entry.kind === option.key).length;
                // A kind with nothing recorded has nothing to filter to.
                if (count === 0 && option.key !== "all") return null;
                return (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={kind === option.key}
                    onClick={() => {
                      setKind(option.key);
                      setLimit(PAGE);
                    }}
                  >
                    {option.label} <span className="audit-count">{count}</span>
                  </button>
                );
              })}
            </div>
            <label className="audit-search">
              <Search size={15} strokeWidth={1.75} aria-hidden="true" />
              <span className="visually-hidden">Search the log</span>
              <input
                type="search"
                placeholder="Search who, what or why"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setLimit(PAGE);
                }}
              />
            </label>
            <label className="audit-who">
              <span className="visually-hidden">Who</span>
              <select
                value={who}
                onChange={(event) => {
                  setWho(event.target.value);
                  setLimit(PAGE);
                }}
              >
                <option value="">Everyone</option>
                {people.map((person) => (
                  <option key={person} value={person}>
                    {person}
                  </option>
                ))}
              </select>
            </label>
            {shown.length > 0 && (
              <a
                className="button secondary"
                download="audit-log.csv"
                href={`data:text/csv;charset=utf-8,${encodeURIComponent(auditCsv(shown))}`}
              >
                <Download size={15} strokeWidth={1.75} aria-hidden="true" />
                Export
              </a>
            )}
          </div>
          {shown.length === 0 ? (
            <p className="muted panel">
              {entries.length === 0 ? "Nothing recorded yet." : "Nothing matches."}
            </p>
          ) : (
            <div className="panel audit-log">
              <TableScroll label="Audit log">
                <table className="audit-table">
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">What</th>
                      <th scope="col">Change</th>
                      <th scope="col">Why</th>
                      <th scope="col">Who</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map(({ day, rows }) => (
                      <Fragment key={day}>
                        <tr className="audit-day">
                          <th scope="colgroup" colSpan={5}>
                            {day}
                          </th>
                        </tr>
                        {rows.map((entry, index) => (
                          <tr key={`${entry.at}-${String(index)}`}>
                            <td className="muted">
                              <time dateTime={entry.at}>{timeOf(entry.at)}</time>
                            </td>
                            <td>
                              <span className={CHIPS[entry.kind]}>{entry.label}</span>
                            </td>
                            <td>
                              {sentence(entry)}
                              {entry.before && <span className="sub">was {entry.before}</span>}
                            </td>
                            <td className="muted">
                              {entry.reason ? <>&ldquo;{entry.reason}&rdquo;</> : "—"}
                            </td>
                            <td>{entry.by}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </div>
          )}
          {shown.length > limit && (
            <p className="audit-more">
              <span className="muted small">
                Showing {limit} of {shown.length}
              </span>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setLimit((n) => n + PAGE);
                }}
              >
                Show {Math.min(PAGE, shown.length - limit)} more
              </button>
            </p>
          )}
        </>
      )}
    </section>
  );
}
