import { ArrowLeft, ChevronRight, Mail, MessageSquare, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ApiError, type Api, type Cover, type CustomerClaim, type Settings } from "../api";
import { ClaimTracker } from "../components/ClaimTracker";
import { Feedback } from "../components/Feedback";
import { NeedsPanel } from "../components/NeedsPanel";
import { CustomerStatusChip } from "../components/StatusChip";
import { WattleMark } from "../components/Wattle";
import { date, dollars, when } from "../format";
import { place } from "./arrival";
import { coverRows, planName } from "./cover";
import { groupNotices } from "./messages";
import { MAX_RECEIPTS, receiptProblem, RECEIPT_TYPES } from "./receipts";
import type { Records } from "./records";

export type PanelTarget =
  | { view: "messages" }
  | { view: "claims"; claimId?: string }
  | { view: "settings"; policyId?: string };

interface SidePanelProps {
  api: Api;
  records: Records;
  target: PanelTarget;
  onTarget: (target: PanelTarget) => void;
  onClose: () => void;
  onChanged: () => void;
  onStartClaim: () => void;
  onAskAboutPolicy: (cover: Cover) => void;
  onSignOut: () => void;
}

const DONE = new Set(["paid", "declined"]);

/** Messages, Claims and Settings: one quiet sheet from the top bar, everything else the
 * customer might look for, so the home screen can stay a conversation. */
export function SidePanel(props: SidePanelProps) {
  const { target, onClose } = props;
  const sheet = useRef<HTMLElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    sheet.current?.querySelector<HTMLElement>("h2")?.focus();
  }, [target]);

  // Focus goes back to whatever opened the panel when it closes.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      opener?.focus();
    };
  }, []);

  return (
    <div className="sheet-backdrop">
      {/* A click outside closes it; Escape and the Close button are the other ways. */}
      <button
        type="button"
        className="sheet-scrim"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
      />
      <aside
        className="sheet"
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-label={title(target)}
      >
        {target.view === "messages" && <MessagesView {...props} />}
        {target.view === "claims" &&
          (target.claimId ? (
            <ClaimView {...props} claimId={target.claimId} />
          ) : (
            <ClaimsView {...props} />
          ))}
        {target.view === "settings" &&
          (target.policyId ? (
            <PolicyView {...props} policyId={target.policyId} />
          ) : (
            <SettingsView {...props} />
          ))}
      </aside>
    </div>
  );
}

function title(target: PanelTarget): string {
  if (target.view === "messages") return "Messages";
  if (target.view === "claims") return target.claimId ? "Your claim" : "Your claims";
  return target.policyId ? "Your policy" : "Settings";
}

function Head({
  children,
  onBack,
  onClose,
}: {
  children: ReactNode;
  onBack?: () => void;
  onClose: () => void;
}) {
  return (
    <div className="sheet-head">
      {onBack && (
        <button type="button" className="icon-button" aria-label="Back" onClick={onBack}>
          <ArrowLeft size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
      <h2 tabIndex={-1}>{children}</h2>
      <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
        <X size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}

// --- Messages ---

function MessagesView({ records, onClose, onTarget }: SidePanelProps) {
  const messages = groupNotices(records.notices);
  return (
    <>
      <Head onClose={onClose}>Messages</Head>
      <p className="sheet-lead">Everything we&apos;ve sent you, by email and text.</p>
      {messages.length === 0 && (
        <p className="sheet-empty">Nothing yet. We&apos;ll let you know here.</p>
      )}
      <ul className="message-list">
        {messages.map(({ main, channels }) => (
          <li key={main.notice_id}>
            <details className="message">
              <summary>
                <span className="message-icon" aria-hidden="true">
                  {channels.includes("email") ? (
                    <Mail size={16} strokeWidth={1.75} />
                  ) : (
                    <MessageSquare size={16} strokeWidth={1.75} />
                  )}
                </span>
                <b dir="auto">{main.subject}</b>
                <span className="message-when">{date(main.sent_at)}</span>
                <span className="message-first" dir="auto">
                  {main.body}
                </span>
              </summary>
              <div className="message-body">
                <p dir="auto">{main.body}</p>
                <p className="sheet-meta">
                  {channels.length === 2
                    ? "Email and text"
                    : channels[0] === "sms"
                      ? "Text"
                      : "Email"}{" "}
                  · {when(main.sent_at)}
                </p>
                {main.claim_id && (
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => {
                      onTarget({ view: "claims", claimId: main.claim_id ?? "" });
                    }}
                  >
                    Open the claim
                  </button>
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </>
  );
}

// --- Claims ---

function ClaimsView({ records, onClose, onTarget, onStartClaim }: SidePanelProps) {
  const open = records.claims.filter((c) => !DONE.has(c.status));
  const done = records.claims.filter((c) => DONE.has(c.status));
  const row = (claim: (typeof records.claims)[number]) => (
    <li key={claim.claim_id}>
      <button
        type="button"
        className="sheet-row"
        onClick={() => {
          onTarget({ view: "claims", claimId: claim.claim_id });
        }}
      >
        <span className="grow">
          <b dir="auto">{claim.summary}</b>
          <span className="sheet-meta">
            {dollars(claim.amount_claimed)} · {date(claim.submitted_on)}
          </span>
        </span>
        {claim.open_requests > 0 ? (
          <span className="chip chip-warn">Needs one thing</span>
        ) : (
          <CustomerStatusChip status={claim.status} />
        )}
      </button>
    </li>
  );
  return (
    <>
      <Head onClose={onClose}>Your claims</Head>
      {records.claims.length === 0 && (
        <p className="sheet-empty">No claims yet. Tell Wattle what happened.</p>
      )}
      {open.length > 0 && (
        <section className="sheet-group">
          <h3>In progress</h3>
          <ul>{open.map(row)}</ul>
        </section>
      )}
      {done.length > 0 && (
        <section className="sheet-group">
          <h3>Done</h3>
          <ul>{done.map(row)}</ul>
        </section>
      )}
      <button type="button" className="button secondary sheet-action" onClick={onStartClaim}>
        Make a claim
      </button>
    </>
  );
}

/** Where a claim stands, in one line the customer could stop at. */
export function claimHeadline(claim: CustomerClaim): string {
  const open = claim.requests.filter((r) => r.fulfilled_at === null).length;
  if (open > 0)
    return open === 1
      ? "We need one thing, then we can carry on."
      : `We need ${String(open)} things, then we can carry on.`;
  switch (claim.status) {
    case "received":
      return "We've got it and will start shortly.";
    case "assessing":
      return "We're looking at it now.";
    case "reviewing":
      return "It's having a final check.";
    case "with_a_handler":
      return "A person is looking after it.";
    case "approved":
      return "Approved. Payment is on its way.";
    case "paid":
      return claim.paid !== null
        ? `Paid ${dollars(claim.paid)}${claim.paid_to ? ` to your ${claim.paid_to}` : ""}${claim.paid_at ? ` on ${date(claim.paid_at)}` : ""}.`
        : "Paid.";
    case "declined":
      return "We couldn't pay this one.";
  }
}

export function ClaimView({
  api,
  records,
  claimId,
  onClose,
  onTarget,
  onChanged,
}: SidePanelProps & { claimId: string }) {
  const id = useId();
  const [claim, setClaim] = useState<CustomerClaim | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let live = true;
    api.myClaim(claimId).then(
      (found) => {
        if (live) setClaim(found);
      },
      (caught: unknown) => {
        if (live)
          setError(caught instanceof ApiError ? caught.message : "We couldn't load this claim.");
      },
    );
    return () => {
      live = false;
    };
  }, [api, claimId]);

  function updated(next: CustomerClaim) {
    setClaim(next);
    onChanged();
  }

  async function askForPerson() {
    setAsking(true);
    setError(null);
    try {
      updated(await api.requestReview(claimId, note.trim()));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We couldn't send that.");
    } finally {
      setAsking(false);
    }
  }

  const sent = groupNotices(records.notices.filter((n) => n.claim_id === claimId));
  const decided = claim?.outcome && claim.outcome !== "refer";
  return (
    <>
      <Head
        onClose={onClose}
        onBack={() => {
          onTarget({ view: "claims" });
        }}
      >
        Your claim
      </Head>
      {!claim && !error && (
        <p role="status" className="sheet-empty">
          Loading your claim…
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {claim && (
        <div className="claim-view">
          {claim.open_requests > 0 ? (
            <span className="chip chip-warn">Needs one thing</span>
          ) : (
            <CustomerStatusChip status={claim.status} />
          )}
          <p className="claim-view-headline">{claimHeadline(claim)}</p>
          <p className="sheet-meta" dir="auto">
            {claim.summary} · {place(claim.incident_location)} · {dollars(claim.amount_claimed)}
          </p>
          <ClaimTracker status={claim.status} />
          <NeedsPanel api={api} claimId={claimId} requests={claim.requests} onUpdated={updated} />
          {decided && (claim.letter ?? claim.reason) && (
            <div className="claim-why">
              <h3>Why</h3>
              <p dir="auto">{claim.letter?.body ?? claim.reason}</p>
            </div>
          )}
          {decided && (
            <div className="claim-ai">
              <WattleMark size={16} />
              <span>Decided with help from our AI, checked by our team</span>
              <Feedback api={api} subject="decision" claimId={claimId} />
            </div>
          )}
          <details className="claim-more">
            <summary>In your words</summary>
            <p dir="auto">{claim.story}</p>
          </details>
          <details className="claim-more">
            <summary>
              What you&apos;re claiming{" "}
              <span className="sheet-meta">{dollars(claim.amount_claimed)}</span>
            </summary>
            <ul>
              {claim.items.map((item, i) => (
                <li key={String(i)} dir="auto">
                  {item.description} · {dollars(item.amount)}
                </li>
              ))}
            </ul>
            <p className="sheet-meta">
              {claim.receipts.length === 0
                ? "No receipts yet."
                : `${String(claim.receipts.length)} ${claim.receipts.length === 1 ? "receipt" : "receipts"} sent.`}
            </p>
          </details>
          {claim.can_add_receipts && <AddReceipts api={api} claim={claim} onUpdated={updated} />}
          <details className="claim-more">
            <summary>
              What we&apos;ve sent you <span className="sheet-meta">{sent.length}</span>
            </summary>
            {sent.length === 0 ? (
              <p className="sheet-meta">Nothing yet.</p>
            ) : (
              <ul>
                {sent.map(({ main }) => (
                  <li key={main.notice_id} dir="auto">
                    {main.subject} · {date(main.sent_at)}
                  </li>
                ))}
              </ul>
            )}
          </details>
          {claim.review_requested && (
            <p className="notice" role="status">
              You asked for a person to look again. A claims handler will be in touch.
            </p>
          )}
          {claim.can_request_review && claim.status !== "with_a_handler" && (
            <div className="claim-person">
              <label htmlFor={`${id}-note`}>
                Want a person to look again? Tell us why (optional)
              </label>
              <textarea
                id={`${id}-note`}
                rows={2}
                maxLength={1000}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
              <button
                type="button"
                className="button secondary"
                disabled={asking}
                onClick={() => {
                  void askForPerson();
                }}
              >
                {asking ? "Sending…" : "Ask a person to look again"}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// --- Settings ---

function AddReceipts({
  api,
  claim,
  onUpdated,
}: {
  api: Api;
  claim: CustomerClaim;
  onUpdated: (claim: CustomerClaim) => void;
}) {
  const id = useId();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const room = MAX_RECEIPTS - claim.receipts.length;

  async function send(chosen: File[]) {
    const problems = chosen.map(receiptProblem).filter((p): p is string => p !== null);
    const good = chosen.filter((file) => receiptProblem(file) === null);
    if (good.length > room)
      problems.push(`A claim can have up to ${String(MAX_RECEIPTS)} receipts.`);
    setError(problems.length > 0 ? problems.join(" ") : null);
    const sending = good.slice(0, Math.max(0, room));
    if (sending.length === 0) return;
    setSending(true);
    try {
      onUpdated(await api.addReceipts(claim.claim_id, sending));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We couldn't send those.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="claim-add">
      <input
        id={id}
        type="file"
        className="visually-hidden"
        accept={RECEIPT_TYPES.join(",")}
        multiple
        disabled={sending || room <= 0}
        onChange={(event) => {
          const chosen = Array.from(event.target.files ?? []);
          event.target.value = "";
          void send(chosen);
        }}
      />
      <label htmlFor={id} className="button secondary" aria-disabled={sending || room <= 0}>
        {sending ? "Sending…" : "Add receipts"}
      </label>
      <span className="sheet-meta">Up to {String(room)} more, JPEG, PNG or PDF</span>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function SettingsView({ api, records, onClose, onTarget, onSignOut }: SidePanelProps) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [payid, setPayid] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    api.mySettings().then(
      (found) => {
        if (live) setSettings(found);
      },
      () => undefined,
    );
    api.myPayId().then(
      (found) => {
        if (live) setPayid(found);
      },
      () => {
        if (live) setPayid(null);
      },
    );
    return () => {
      live = false;
    };
  }, [api]);

  return (
    <>
      <Head onClose={onClose}>Settings</Head>
      <section className="sheet-group">
        <h3>Getting paid</h3>
        <EditRow
          label="PayID"
          value=""
          shown={payid === undefined ? "…" : (payid ?? "Not set")}
          hint="An email, a mobile (04…) or an ABN"
          save={async (value) => {
            setPayid(await api.setPayId(value));
          }}
        />
      </section>
      <section className="sheet-group">
        <h3>Your details</h3>
        <div className="sheet-row static">
          <span className="grow">Email</span>
          <span className="sheet-meta">{settings?.email ?? "…"}</span>
        </div>
        {settings && (
          <EditRow
            label="Mobile"
            value={settings.mobile}
            shown={settings.mobile || "Not set"}
            hint="Digits, with + for a country code; leave it empty to remove it"
            allowEmpty
            save={async (value) => {
              setSettings(
                await api.setSettings({ mobile: value, text_updates: settings.text_updates }),
              );
            }}
          />
        )}
        <p className="sheet-note">
          To change your email, talk to a person: it&apos;s how you sign in.
        </p>
      </section>
      <section className="sheet-group">
        <h3>Updates</h3>
        <div className="sheet-row static">
          <span className="grow">
            Email me
            <span className="sheet-meta">Always, for anything about a claim</span>
          </span>
        </div>
        {settings && (
          <label className="sheet-row static switch-row">
            <span className="grow">Text me</span>
            <input
              type="checkbox"
              role="switch"
              className="switch"
              checked={settings.text_updates}
              onChange={(event) => {
                const text_updates = event.target.checked;
                const before = settings;
                setProblem(null);
                setSettings({ ...before, text_updates });
                api.setSettings({ mobile: before.mobile, text_updates }).then(
                  (saved) => {
                    setSettings((now) => (now?.text_updates === text_updates ? saved : now));
                  },
                  (caught: unknown) => {
                    setSettings((now) => (now?.text_updates === text_updates ? before : now));
                    setProblem(
                      caught instanceof ApiError ? caught.message : "We couldn't save that.",
                    );
                  },
                );
              }}
            />
          </label>
        )}
        {problem && (
          <p className="error" role="alert">
            {problem}
          </p>
        )}
      </section>
      <section className="sheet-group">
        <h3>Your policies</h3>
        <ul>
          {records.cover.map((cover) => (
            <li key={cover.policy_id}>
              <button
                type="button"
                className="sheet-row"
                onClick={() => {
                  onTarget({ view: "settings", policyId: cover.policy_id });
                }}
              >
                <span className="grow">
                  <b>
                    {planName(cover)} · {place(cover.destination)}
                  </b>
                  <span className="sheet-meta">
                    {date(cover.departs_on)} to {date(cover.returns_on)}
                  </span>
                </span>
                <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </section>
      <button type="button" className="button secondary sheet-action" onClick={onSignOut}>
        Sign out
      </button>
    </>
  );
}

function EditRow({
  label,
  value,
  shown,
  hint,
  save,
  allowEmpty = false,
}: {
  label: string;
  value: string;
  shown: string;
  hint: string;
  save: (value: string) => Promise<void>;
  /** Saving an empty field removes the value. */
  allowEmpty?: boolean;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <button
        type="button"
        className="sheet-row"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
      >
        <span className="grow">{label}</span>
        <span className="sheet-meta">{shown}</span>
        <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
    );
  }
  return (
    <form
      className="sheet-edit"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        save(draft.trim()).then(
          () => {
            setBusy(false);
            setEditing(false);
          },
          (caught: unknown) => {
            setBusy(false);
            setError(caught instanceof ApiError ? caught.message : "We couldn't save that.");
          },
        );
      }}
    >
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={draft}
        maxLength={320}
        aria-describedby={`${id}-hint`}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
      />
      <p id={`${id}-hint`} className="sheet-meta">
        {hint}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="sheet-edit-actions">
        <button type="submit" className="button" disabled={busy || (!allowEmpty && !draft.trim())}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="text-link"
          onClick={() => {
            setEditing(false);
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function PolicyView({
  records,
  policyId,
  onClose,
  onTarget,
  onAskAboutPolicy,
}: SidePanelProps & { policyId: string }) {
  const cover = records.cover.find((c) => c.policy_id === policyId);
  return (
    <>
      <Head
        onClose={onClose}
        onBack={() => {
          onTarget({ view: "settings" });
        }}
      >
        {cover ? planName(cover) : "Your policy"}
      </Head>
      {!cover && <p className="sheet-empty">We couldn&apos;t find that policy.</p>}
      {cover && (
        <>
          <p className="sheet-lead">
            {cover.destination}
            <br />
            {date(cover.departs_on)} to {date(cover.returns_on)}
          </p>
          <div className="cover-rows">
            {coverRows(cover).map(([what, amount]) => (
              <div key={what} className="sheet-row static">
                <span className="grow">{what}</span>
                <b>{amount}</b>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="button secondary sheet-action"
            onClick={() => {
              onAskAboutPolicy(cover);
            }}
          >
            Ask about this policy
          </button>
        </>
      )}
    </>
  );
}
