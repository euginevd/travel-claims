import { Check, Clock, FileText, Paperclip, PenLine, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  type Answer,
  type Api,
  type CaseChip,
  type CustomerClaim,
  type DelayOffer,
  type Policy,
} from "../api";
import { ClaimTracker } from "../components/ClaimTracker";
import { Feedback } from "../components/Feedback";
import { NeedsPanel } from "../components/NeedsPanel";
import { RECEIPT_TYPES } from "./receipts";
import { bolded, WattleMark } from "../components/Wattle";
import { date, dollars } from "../format";
import { place, type News } from "./arrival";
import { dayInTrip, total, type Filled, type Line, type Missing } from "./claimFlow";
import { coverRows, planName } from "./cover";
import type { Records } from "./records";
import type { PanelTarget } from "./SidePanel";
import { claimHeadline } from "./SidePanel";

// The conversation's turns and the cards in them, as Home lays them out. Home holds the state.

// --- What the conversation holds ---

export type Card =
  | { type: "cover"; policyId: string }
  | { type: "claim"; claimId: string }
  | { type: "claims" }
  | { type: "needs"; claimId: string }
  | { type: "upload" }
  | { type: "date"; min: string; max: string }
  // What the claim says, kept on the card so it stays after the claim is sent.
  | { type: "check"; filled: Filled }
  | { type: "delay"; offer: DelayOffer }
  | { type: "settings" }
  | { type: "person" };

export interface Choice {
  label: string;
  run: () => void;
  primary?: boolean;
}

export type Turn =
  | { who: "me"; text: string; files?: number }
  | {
      who: "wattle";
      headline?: string;
      lines?: string[];
      points?: Answer["points"];
      /** A quiet line saying what Wattle checked, once it's done. */
      checked?: string;
      card?: Card;
      choices?: Choice[];
      /** The question an answer was to, for its thumbs. */
      voteOn?: string;
      policyChip?: boolean;
      /** The trip a claim is on, with a way to pick another when there's more than one. */
      trip?: { label: string; change?: () => void };
      error?: boolean;
    };

/** A claim being made by chat. */
export interface Flow {
  chip: CaseChip;
  policyId: string;
  words: string[];
  day: string;
  files: File[];
  filled: Filled | null;
  asked: Set<string>;
  /** What a typed message answers right now. */
  waiting: "first" | "files" | "missing" | "edit" | "none";
  missing: Missing | null;
}

export function NewsLine({
  news,
  onOpen,
  onDismiss,
}: {
  news: News;
  onOpen: (n: News) => void;
  onDismiss: (n: News) => void;
}) {
  return (
    <div className={`news news-${news.tone}`}>
      <button
        type="button"
        className="news-main"
        onClick={() => {
          onOpen(news);
        }}
      >
        <span className="news-icon" aria-hidden="true">
          {news.tone === "need" ? (
            <Paperclip size={16} strokeWidth={1.75} />
          ) : news.go.to === "draft" ? (
            <PenLine size={16} strokeWidth={1.75} />
          ) : news.go.to === "delay" ? (
            <Clock size={16} strokeWidth={1.75} />
          ) : news.tone === "plain" ? (
            <FileText size={16} strokeWidth={1.75} />
          ) : (
            <Check size={16} strokeWidth={2} />
          )}
        </span>
        <span className="grow">
          <b>{news.title}</b>
          <span className="news-detail" dir="auto">
            {news.detail}
          </span>
        </span>
        <span className="news-go">{news.action}</span>
      </button>
      <button
        type="button"
        className="news-x"
        aria-label={news.sticky ? "Remind me next time" : "Dismiss"}
        onClick={() => {
          onDismiss(news);
        }}
      >
        <X size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}

export function MyTurn({ turn }: { turn: Extract<Turn, { who: "me" }> }) {
  return (
    <div className="turn me">
      {turn.files ? (
        <span className="turn-files" aria-label={`${String(turn.files)} files`}>
          {Array.from({ length: Math.min(turn.files, 5) }, (_, i) => (
            <span key={String(i)} className="turn-file" aria-hidden="true" />
          ))}
        </span>
      ) : null}
      {!turn.files && <p dir="auto">{turn.text}</p>}
    </div>
  );
}

interface WattleTurnProps {
  turn: Extract<Turn, { who: "wattle" }>;
  live: boolean;
  api: Api;
  records: Records;
  flow: Flow | null;
  onOpen: (target: PanelTarget) => void;
  onChanged: () => void;
  onFiles: (files: File[]) => void;
  onDate: (day: string) => void;
  onSend: () => void;
  onSaveCheck: (filled: Filled) => void;
  onClaimDelay: (offer: DelayOffer) => void;
  onPolicy: () => void;
}

export function WattleTurn(props: WattleTurnProps) {
  const { turn, live, api, onPolicy } = props;
  return (
    <div className={`turn wattle${turn.error ? " is-error" : ""}`}>
      <WattleMark size={28} />
      <div className="turn-body">
        {turn.checked && (
          <p className="turn-checked">
            <Check size={12} strokeWidth={3} aria-hidden="true" /> {turn.checked}
          </p>
        )}
        {turn.headline && (
          <p className="turn-headline" dir="auto">
            {turn.headline}
          </p>
        )}
        {turn.lines?.map((line) => (
          <p key={line} className="turn-line" dir="auto">
            {line}
          </p>
        ))}
        {turn.points && turn.points.length > 0 && (
          <ul className="turn-points">
            {turn.points.map((point, i) => (
              <li key={String(i)} dir="auto">
                <span>{bolded(point.text)}</span>
              </li>
            ))}
          </ul>
        )}
        {turn.policyChip && (
          <button type="button" className="source-chip" onClick={onPolicy}>
            <FileText size={13} strokeWidth={1.75} aria-hidden="true" /> Your policy
          </button>
        )}
        {(turn.policyChip || turn.card?.type === "cover") && (
          <p className="turn-note">General information only; your policy wording decides.</p>
        )}
        {turn.trip && (
          <p className="turn-note">
            {turn.trip.label}
            {live && turn.trip.change && (
              <>
                {" · "}
                <button type="button" className="text-link" onClick={turn.trip.change}>
                  change
                </button>
              </>
            )}
          </p>
        )}
        {turn.card && <TurnCard {...props} card={turn.card} />}
        {live && turn.choices && turn.choices.length > 0 && (
          <div className="choices">
            {turn.choices.map((choice) => (
              <button key={choice.label} type="button" className="choice" onClick={choice.run}>
                {choice.label}
              </button>
            ))}
          </div>
        )}
        {turn.voteOn && (
          <div className="turn-vote">
            <Feedback api={api} subject="answer" question={turn.voteOn} />
          </div>
        )}
      </div>
    </div>
  );
}

export const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

function CardShell({ children }: { children: ReactNode }) {
  return (
    <div className="card-ring">
      <div className="card-in">{children}</div>
    </div>
  );
}

function TurnCard({
  card,
  live,
  api,
  records,
  flow,
  onOpen,
  onChanged,
  onFiles,
  onDate,
  onSend,
  onSaveCheck,
  onClaimDelay,
}: WattleTurnProps & { card: Card }) {
  switch (card.type) {
    case "cover": {
      const cover = records.cover.find((c) => c.policy_id === card.policyId);
      if (!cover) return null;
      return (
        <CardShell>
          <p className="card-title">
            {planName(cover)} · {place(cover.destination)}
          </p>
          <p className="card-meta">
            {date(cover.departs_on)} to {date(cover.returns_on)}
          </p>
          <div className="card-figures">
            {coverRows(cover)
              .filter(([what]) => ["Medical", "Bags", "You pay first"].includes(what))
              .map(([what, amount]) => (
                <div key={what}>
                  <small>{what}</small>
                  <b>{amount}</b>
                </div>
              ))}
          </div>
          <button
            type="button"
            className="text-link"
            onClick={() => {
              onOpen({ view: "settings", policyId: cover.policy_id });
            }}
          >
            See all your cover
          </button>
        </CardShell>
      );
    }
    case "claim":
      return <ClaimCard api={api} claimId={card.claimId} onOpen={onOpen} />;
    case "claims": {
      const claims = records.claims.slice(0, 4);
      return (
        <CardShell>
          {claims.length === 0 && <p className="card-meta">No claims yet.</p>}
          <ul className="card-list">
            {claims.map((claim) => (
              <li key={claim.claim_id}>
                <button
                  type="button"
                  className="card-row"
                  onClick={() => {
                    onOpen({ view: "claims", claimId: claim.claim_id });
                  }}
                >
                  <span className="grow" dir="auto">
                    {claim.summary}
                  </span>
                  <span className="card-meta">{dollars(claim.amount_claimed)}</span>
                </button>
              </li>
            ))}
          </ul>
        </CardShell>
      );
    }
    case "needs":
      return <NeedsCard api={api} claimId={card.claimId} onChanged={onChanged} />;
    case "upload":
      return live && flow?.waiting === "files" ? <UploadCard onFiles={onFiles} /> : null;
    case "date":
      return live && flow?.waiting === "missing" ? (
        <DateCard min={card.min} max={card.max} onDate={onDate} />
      ) : null;
    case "check": {
      const trip = records.policies.find((p) => p.policy_id === flow?.policyId)?.trip;
      return (
        <CheckCard
          filled={card.filled}
          ready={live && flow?.waiting === "edit"}
          trip={trip}
          onSend={onSend}
          onSave={onSaveCheck}
        />
      );
    }
    case "delay":
      return (
        <CardShell>
          <p className="card-title">
            Flight {card.offer.flight} · {card.offer.route}
          </p>
          <p className="card-meta">
            {date(card.offer.date)} · about {dollars(card.offer.estimate)}
          </p>
          {live && (
            <div className="card-actions">
              <button
                type="button"
                className="button"
                onClick={() => {
                  onClaimDelay(card.offer);
                }}
              >
                Claim {dollars(card.offer.estimate)}
              </button>
            </div>
          )}
        </CardShell>
      );
    case "settings":
      return (
        <CardShell>
          <p className="card-meta">
            PayID, mobile and texts are in Settings. Only you can change them.
          </p>
          <div className="card-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                onOpen({ view: "settings" });
              }}
            >
              Open Settings
            </button>
          </div>
        </CardShell>
      );
    case "person":
      return <PersonCard records={records} onOpen={onOpen} />;
  }
}

function ClaimCard({
  api,
  claimId,
  onOpen,
}: {
  api: Api;
  claimId: string;
  onOpen: (t: PanelTarget) => void;
}) {
  const { claim, failed, retry } = useClaim(api, claimId);
  if (failed) return <LoadFailed retry={retry} />;
  if (!claim)
    return (
      <p className="card-meta" role="status">
        Loading…
      </p>
    );
  return (
    <CardShell>
      <p className="card-title" dir="auto">
        {claim.summary}
      </p>
      <p className="card-meta">
        {claimHeadline(claim)} · {dollars(claim.amount_claimed)}
      </p>
      <ClaimTracker status={claim.status} mini />
      <button
        type="button"
        className="text-link"
        onClick={() => {
          onOpen({ view: "claims", claimId });
        }}
      >
        See details
      </button>
    </CardShell>
  );
}

/** One of the customer's claims, loaded for a card, with a way to try again. */
function useClaim(api: Api, claimId: string) {
  const [claim, setClaim] = useState<CustomerClaim | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    api.myClaim(claimId).then(
      (found) => {
        if (live) setClaim(found);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [api, claimId, attempt]);
  return {
    claim,
    setClaim,
    failed,
    retry: () => {
      setFailed(false);
      setAttempt((n) => n + 1);
    },
  };
}

function LoadFailed({ retry }: { retry: () => void }) {
  return (
    <p className="card-meta" role="alert">
      I couldn&apos;t load that claim.{" "}
      <button type="button" className="text-link" onClick={retry}>
        Try again
      </button>
    </p>
  );
}

function NeedsCard({
  api,
  claimId,
  onChanged,
}: {
  api: Api;
  claimId: string;
  onChanged: () => void;
}) {
  const { claim, setClaim, failed, retry } = useClaim(api, claimId);
  if (failed) return <LoadFailed retry={retry} />;
  if (!claim)
    return (
      <p className="card-meta" role="status">
        Loading…
      </p>
    );
  return (
    <CardShell>
      <NeedsPanel
        api={api}
        claimId={claimId}
        requests={claim.requests}
        onUpdated={(next) => {
          setClaim(next);
          onChanged();
        }}
      />
    </CardShell>
  );
}

function UploadCard({ onFiles }: { onFiles: (files: File[]) => void }) {
  const id = useId();
  const [dragging, setDragging] = useState(false);
  const zone = useRef<HTMLLabelElement>(null);
  const onFilesNow = useRef(onFiles);
  useEffect(() => {
    onFilesNow.current = onFiles;
  });
  useEffect(() => {
    const el = zone.current;
    if (!el) return;
    const over = (event: DragEvent) => {
      event.preventDefault();
      setDragging(true);
    };
    const leave = () => {
      setDragging(false);
    };
    const drop = (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      onFilesNow.current(Array.from(event.dataTransfer?.files ?? []));
    };
    el.addEventListener("dragover", over);
    el.addEventListener("dragleave", leave);
    el.addEventListener("drop", drop);
    return () => {
      el.removeEventListener("dragover", over);
      el.removeEventListener("dragleave", leave);
      el.removeEventListener("drop", drop);
    };
  }, []);
  return (
    <>
      <label ref={zone} htmlFor={id} className={`drop${dragging ? " is-over" : ""}`}>
        <span className="drop-icon" aria-hidden="true">
          <Paperclip size={18} strokeWidth={1.75} />
        </span>
        <span className="grow">
          <b>Add photos or files</b>
          <span className="card-meta">Snap them or drop them here</span>
        </span>
        <span className="button secondary">Add</span>
      </label>
      <input
        id={id}
        type="file"
        className="visually-hidden"
        accept={RECEIPT_TYPES.join(",")}
        multiple
        onChange={(event) => {
          const chosen = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (chosen.length > 0) onFiles(chosen);
        }}
      />
    </>
  );
}

function DateCard({
  min,
  max,
  onDate,
}: {
  min: string;
  max: string;
  onDate: (day: string) => void;
}) {
  const id = useId();
  const [day, setDay] = useState("");
  return (
    <CardShell>
      <form
        className="card-date"
        onSubmit={(event) => {
          event.preventDefault();
          if (day) onDate(day);
        }}
      >
        <label htmlFor={id} className="visually-hidden">
          The day it happened
        </label>
        <input
          id={id}
          type="date"
          min={min}
          max={max}
          value={day}
          onChange={(event) => {
            setDay(event.target.value);
          }}
        />
        <button type="submit" className="button secondary" disabled={!day}>
          That&apos;s the day
        </button>
      </form>
    </CardShell>
  );
}

function PersonCard({ records, onOpen }: { records: Records; onOpen: (t: PanelTarget) => void }) {
  const decided = records.claims.find(
    (c) => c.status === "declined" || c.status === "paid" || c.status === "approved",
  );
  return (
    <CardShell>
      <p className="card-title">Talk to a person</p>
      <p className="card-meta">
        Email claims@undercover.example and a claims handler will reply within a day.
        {decided ? " To have a decision looked at again, open the claim." : ""}
      </p>
      {decided && (
        <button
          type="button"
          className="text-link"
          onClick={() => {
            onOpen({ view: "claims", claimId: decided.claim_id });
          }}
        >
          Open {decided.summary}
        </button>
      )}
    </CardShell>
  );
}

/** The claim before it's sent. The day (inside the trip), the place and each item's amount can
 * be changed right here, no chat needed. */
function CheckCard({
  filled,
  ready,
  trip,
  onSend,
  onSave,
}: {
  filled: Filled;
  ready: boolean;
  trip?: Pick<Policy["trip"], "departs_on" | "returns_on">;
  onSend: () => void;
  onSave: (filled: Filled) => void;
}) {
  const id = useId();
  const [editing, setEditing] = useState<Filled | null>(null);
  const [problem, setProblem] = useState("");

  if (editing && ready) {
    const setLine = (index: number, change: Partial<Line>) => {
      setEditing({
        ...editing,
        lines: editing.lines.map((line, i) => (i === index ? { ...line, ...change } : line)),
      });
    };
    return (
      <CardShell>
        <form
          className="check-edit"
          onSubmit={(event) => {
            event.preventDefault();
            if (!dayInTrip(editing.incidentDate, trip)) {
              setProblem("Pick a day during the trip.");
              return;
            }
            if (!editing.location.trim()) {
              setProblem("Say where it happened.");
              return;
            }
            if (editing.lines.some((line) => !line.description.trim() || !(line.amount > 0))) {
              setProblem("Each item needs a name and an amount.");
              return;
            }
            setProblem("");
            onSave({ ...editing, location: editing.location.trim() });
            setEditing(null);
          }}
        >
          <label htmlFor={`${id}-day`}>Day</label>
          <input
            id={`${id}-day`}
            type="date"
            min={trip?.departs_on}
            max={trip?.returns_on}
            value={editing.incidentDate}
            onChange={(event) => {
              setEditing({ ...editing, incidentDate: event.target.value });
            }}
          />
          <label htmlFor={`${id}-place`}>Where</label>
          <input
            id={`${id}-place`}
            value={editing.location}
            maxLength={120}
            onChange={(event) => {
              setEditing({ ...editing, location: event.target.value });
            }}
          />
          {editing.lines.map((line, i) => (
            <div key={String(i)} className="check-line">
              <label htmlFor={`${id}-item-${String(i)}`} className="visually-hidden">
                Item {i + 1}
              </label>
              <input
                id={`${id}-item-${String(i)}`}
                value={line.description}
                maxLength={120}
                onChange={(event) => {
                  setLine(i, { description: event.target.value });
                }}
              />
              <label htmlFor={`${id}-amount-${String(i)}`} className="visually-hidden">
                Amount for item {i + 1}
              </label>
              <input
                id={`${id}-amount-${String(i)}`}
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={line.amount || ""}
                onChange={(event) => {
                  setLine(i, { amount: Number(event.target.value) });
                }}
              />
              {editing.lines.length > 1 && (
                <button
                  type="button"
                  className="text-link"
                  aria-label={`Remove item ${String(i + 1)}`}
                  onClick={() => {
                    setEditing({ ...editing, lines: editing.lines.filter((_, at) => at !== i) });
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {problem && (
            <p className="field-error" role="alert">
              {problem}
            </p>
          )}
          <div className="card-actions">
            <button type="submit" className="button">
              Save
            </button>
            <button
              type="button"
              className="text-link"
              onClick={() => {
                setEditing(null);
                setProblem("");
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </CardShell>
    );
  }

  return (
    <CardShell>
      <p className="card-title" dir="auto">
        {filled.summary}
      </p>
      <p className="card-meta" dir="auto">
        {filled.location} · {date(filled.incidentDate)}
      </p>
      <ul className="card-lines">
        {filled.lines.map((line, i) => (
          <li key={String(i)}>
            <span dir="auto">{line.description}</span>
            <span>{dollars(line.amount)}</span>
          </li>
        ))}
      </ul>
      <div className="card-figures one">
        <div>
          <small>You&apos;re claiming</small>
          <b>{dollars(total(filled.lines))}</b>
        </div>
      </div>
      {ready && (
        <div className="card-actions">
          <button type="button" className="button" onClick={onSend}>
            Send claim
          </button>
          <button
            type="button"
            className="text-link"
            onClick={() => {
              setEditing(filled);
            }}
          >
            Change something
          </button>
        </div>
      )}
    </CardShell>
  );
}
