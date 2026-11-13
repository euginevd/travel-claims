import { ArrowUp, Camera, Check, FileText, Paperclip, Shield, Luggage, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ApiError,
  caseChips,
  type Answer,
  type Api,
  type AskTurn,
  type CaseChip,
  type Cover,
  type CustomerClaim,
  type DelayOffer,
} from "../api";
import { ClaimTracker } from "../components/ClaimTracker";
import { Feedback } from "../components/Feedback";
import { NeedsPanel } from "../components/NeedsPanel";
import { MAX_RECEIPTS, receiptProblem, RECEIPT_TYPES } from "./receipts";
import { bolded, WattleMark } from "../components/Wattle";
import { date, dollars } from "../format";
import {
  latestPolicy,
  loadDismissed,
  pickNews,
  place,
  saveDismissed,
  suggestions,
  type News,
  type Suggestion,
} from "./arrival";
import {
  amountsIn,
  ASK_FOR_FILES,
  CHIP_LABEL,
  CHIP_TYPE,
  fill,
  firstQuestion,
  dayInTrip,
  missingText,
  nextMissing,
  restored,
  toNewClaim,
  toSaved,
  total,
  type Filled,
  type Missing,
  type Reply,
} from "./claimFlow";
import { coverLine, coverRows, planName } from "./cover";
import type { Records } from "./records";
import type { PanelTarget } from "./SidePanel";
import { claimHeadline } from "./SidePanel";

// --- What the conversation holds ---

type Card =
  | { type: "cover"; policyId: string }
  | { type: "claim"; claimId: string }
  | { type: "claims" }
  | { type: "needs"; claimId: string }
  | { type: "upload" }
  | { type: "date"; min: string; max: string }
  | { type: "check" }
  | { type: "delay"; offer: DelayOffer }
  | { type: "settings" }
  | { type: "person" };

interface Choice {
  label: string;
  run: () => void;
  primary?: boolean;
}

type Turn =
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
      error?: boolean;
    };

/** A claim being made by chat. */
interface Flow {
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

interface HomeProps {
  api: Api;
  firstName: string;
  records: Records;
  loaded: boolean;
  onOpen: (target: PanelTarget) => void;
  onChanged: () => void;
  /** Something to start with, set from outside the conversation. */
  start: { kind: "claim" } | { kind: "policy"; cover: Cover } | null;
}

const GREETING_TYPES: CaseChip[] = [
  "lost_bag",
  "delayed_bag",
  "flight_delay",
  "medical",
  "stolen",
  "passport",
  "trip_cancelled",
  "other",
];

export function Home({ api, firstName, records, loaded, onOpen, onChanged, start }: HomeProps) {
  const ids = useId();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [flow, setFlowState] = useState<Flow | null>(null);
  // Taps run later than the render that made them, so they read the claim as it is now.
  const flowNow = useRef<Flow | null>(null);
  const setFlow = (next: Flow | null) => {
    flowNow.current = next;
    setFlowState(next);
  };
  const busyNow = useRef<string | null>(null);
  const setBusyBoth = (next: string | null) => {
    busyNow.current = next;
    setBusy(next);
  };
  const historyNow = useRef<AskTurn[]>([]);
  // Files chosen before a claim has started wait here for it.
  const pendingFiles = useRef<File[]>([]);
  // Each draft has a number; one that comes back after a newer draft or a send is dropped.
  const draftRun = useRef(0);
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed);
  // Something we need comes back next visit, so it's hidden for this visit only.
  const [hiddenNow, setHiddenNow] = useState<Set<string>>(new Set());
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);

  const empty = turns.length === 0;
  const news = loaded
    ? pickNews(records.claims, records.delays, records.draft, new Set([...dismissed, ...hiddenNow]))
    : null;
  const suggested = loaded ? suggestions(records.policies, records.claims, news) : [];

  useEffect(() => {
    if (typeof end.current?.scrollIntoView === "function")
      end.current.scrollIntoView({ block: "end" });
  }, [turns, busy]);

  const say = (turn: Turn) => {
    setTurns((now) => [...now, turn]);
  };
  const me = (said: string, count?: number) => {
    say({ who: "me", text: said, files: count });
  };

  // --- Arrival ---

  function dismiss(item: News) {
    if (item.sticky) {
      setHiddenNow(new Set([...hiddenNow, item.key]));
      return;
    }
    const next = new Set([...dismissed, item.key]);
    setDismissed(next);
    saveDismissed(next);
  }

  function openNews(item: News) {
    if (item.go.to === "claim") {
      const claimId = item.go.claimId;
      const claim = records.claims.find((c) => c.claim_id === claimId);
      me(item.title);
      if (item.tone === "need") {
        say({
          who: "wattle",
          headline: "Send this and we can carry on.",
          card: { type: "needs", claimId },
        });
      } else {
        say({ who: "wattle", headline: claim?.status_text, card: { type: "claim", claimId } });
      }
    } else if (item.go.to === "delay") {
      const offer = item.go.offer;
      me(item.title);
      say({
        who: "wattle",
        headline: `Your flight was late enough to claim. I can send it now, nothing to fill in.`,
        card: { type: "delay", offer },
      });
    } else {
      resumeDraft();
    }
  }

  function pick(suggestion: Suggestion) {
    if (suggestion.kind === "trip") {
      me(suggestion.label);
      askWhatHappened(suggestion.policyId, true);
    } else if (suggestion.kind === "claim") {
      me(suggestion.label);
      showClaim(suggestion.claimId);
    } else {
      showCover(suggestion.policyId, suggestion.label);
    }
  }

  // --- Things Wattle shows from the records, with no model call ---

  function showClaim(claimId: string) {
    say({ who: "wattle", card: { type: "claim", claimId } });
  }

  function showCover(policyId: string, asked: string) {
    me(asked);
    const cover = records.cover.find((c) => c.policy_id === policyId);
    say({
      who: "wattle",
      headline: cover
        ? cover.plan.deductible > 0
          ? `You're on ${planName(cover)}.`
          : `You're on ${planName(cover)}, with nothing to pay first on any claim.`
        : "Here's your cover.",
      card: { type: "cover", policyId },
      choices: [
        {
          label: "What's not covered?",
          run: () => {
            void ask("What's not covered on my policy?");
          },
        },
        {
          label: "Make a claim",
          run: () => {
            askWhatHappened(policyId);
          },
        },
      ],
    });
  }

  // --- A claim by chat ---

  function askWhatHappened(policyId: string, sorry = false) {
    if (!policyId) {
      say({
        who: "wattle",
        headline: "I can't find a policy to claim on. A person can help.",
        card: { type: "person" },
      });
      return;
    }
    say({
      who: "wattle",
      headline: sorry ? `Oh no, sorry ${firstName}. What happened?` : "What happened?",
      choices: GREETING_TYPES.map((chip) => ({
        label: CHIP_LABEL[chip],
        run: () => {
          me(CHIP_LABEL[chip]);
          startClaim(chip, policyId);
        },
      })),
    });
  }

  function startClaim(chip: CaseChip, policyId: string, intro = true, words: string[] = []) {
    const policy = records.policies.find((p) => p.policy_id === policyId);
    if (!policy) return;
    const cover = records.cover.find((c) => c.policy_id === policyId);
    const question = firstQuestion(chip, policy);
    const waiting = pendingFiles.current;
    pendingFiles.current = [];
    setFlow({
      chip,
      policyId,
      words,
      day: "",
      files: waiting,
      filled: null,
      asked: new Set(),
      waiting: "first",
      missing: null,
    });
    say({
      who: "wattle",
      headline: intro
        ? chip === "other"
          ? "Let's sort it out."
          : `Sorry ${firstName}, let's sort it out.`
        : undefined,
      lines: [
        ...(cover && chip !== "other"
          ? [`${coverLine(cover, chip)} For your ${place(policy.trip.destination)} trip.`]
          : []),
        question.text,
      ],
      policyChip: Boolean(cover && chip !== "other"),
      choices: question.replies.map((reply) => ({
        label: reply.label,
        run: () => {
          answerFirst(reply.says, reply);
        },
      })),
    });
  }

  function answerFirst(said: string, reply?: Reply) {
    const now = flowNow.current;
    if (!now) return;
    me(reply?.label ?? said);
    const next: Flow = {
      ...now,
      words: [...now.words, said],
      day: reply?.day ?? now.day,
      waiting: "files",
    };
    setFlow(next);
    say({
      who: "wattle",
      headline: ASK_FOR_FILES[now.chip],
      card: { type: "upload" },
      choices: [
        {
          label: "I don't have them yet",
          run: () => {
            me("I don't have them yet");
            void draftClaim(flowNow.current ?? next, []);
          },
        },
      ],
    });
    void api.saveDraft(toSaved(next.policyId, next.chip, next.words, null)).catch(() => undefined);
  }

  function chooseFiles(chosen: File[]) {
    if (busyNow.current || chosen.length === 0) return;
    const flow = flowNow.current;
    if (flow?.waiting === "none") return;
    const problems = chosen.map(receiptProblem).filter((p): p is string => p !== null);
    let good = chosen.filter((file) => receiptProblem(file) === null);
    // Five in all, across every batch: the api takes no more.
    const room = MAX_RECEIPTS - (flow ? flow.files.length : pendingFiles.current.length);
    if (good.length > room) {
      problems.push(`A claim can have up to ${String(MAX_RECEIPTS)} files.`);
      good = good.slice(0, Math.max(0, room));
    }
    if (problems.length > 0) {
      say({ who: "wattle", headline: problems.join(" "), error: true });
      if (good.length === 0) return;
    }
    me(good.length === 1 ? "1 file" : `${String(good.length)} files`, good.length);
    if (!flow) {
      // Files first, like a photo of a receipt: keep them and ask what happened.
      pendingFiles.current = [...pendingFiles.current, ...good];
      askWhatHappened(latestPolicy(records.policies)?.policy_id ?? "");
      return;
    }
    if (flow.waiting === "first") {
      setFlow({ ...flow, files: [...flow.files, ...good] });
      return;
    }
    void draftClaim(flow, good);
  }

  async function draftClaim(current: Flow, chosen: File[]) {
    const withFiles = {
      ...current,
      files: [...current.files, ...chosen],
      waiting: "none" as const,
    };
    setFlow(withFiles);
    const run = ++draftRun.current;
    setBusyBoth(chosen.length > 0 ? "Reading what you sent…" : "Putting your claim together…");
    let draft = null;
    try {
      draft = await api.draft(
        withFiles.policyId,
        withFiles.words.join(" "),
        withFiles.chip,
        withFiles.files,
      );
    } catch {
      // Without the assistant, code asks for each thing it needs instead.
    }
    // A newer draft, a send or a new chat has moved on: this one is out of date.
    if (run !== draftRun.current || flowNow.current === null) return;
    setBusyBoth(null);
    const filled = mergeFilled(
      fill(draft, withFiles.chip, withFiles.words, withFiles.day),
      withFiles.filled,
    );
    continueClaim(
      { ...withFiles, filled },
      chosen.length > 0
        ? `Read ${String(chosen.length)} ${chosen.length === 1 ? "document" : "documents"}`
        : undefined,
    );
  }

  /** What the customer already told us stays, unless the new draft knows better. */
  function mergeFilled(next: Filled, before: Filled | null): Filled {
    if (!before) return next;
    return {
      ...next,
      incidentDate: next.incidentDate || before.incidentDate,
      location: next.location || before.location,
      lines: next.lines.length > 0 ? next.lines : before.lines,
      claimType: next.claimType || before.claimType,
    };
  }

  function continueClaim(current: Flow, checked?: string) {
    if (!current.filled) return;
    void api
      .saveDraft(toSaved(current.policyId, current.chip, current.words, current.filled))
      .catch(() => undefined);
    const trip = records.policies.find((p) => p.policy_id === current.policyId)?.trip;
    const missing = nextMissing(current.filled, current.asked, trip);
    if (!missing) {
      setFlow({ ...current, waiting: "edit", missing: null });
      say({
        who: "wattle",
        checked,
        headline: "All set. Happy for me to send this?",
        card: { type: "check" },
      });
      return;
    }
    const asked =
      typeof missing === "object" ? new Set([...current.asked, missing.question]) : current.asked;
    setFlow({ ...current, asked, waiting: "missing", missing });
    const policy = records.policies.find((p) => p.policy_id === current.policyId);
    if (missing === "date" && policy) {
      say({
        who: "wattle",
        checked,
        headline: missingText(missing),
        card: { type: "date", min: policy.trip.departs_on, max: policy.trip.returns_on },
      });
    } else if (missing === "type") {
      say({
        who: "wattle",
        checked,
        headline: missingText(missing),
        choices: caseChips
          .filter((chip) => chip !== "other")
          .map((chip) => ({
            label: CHIP_LABEL[chip],
            run: () => {
              const latest = flowNow.current ?? current;
              if (!latest.filled) return;
              me(CHIP_LABEL[chip]);
              continueClaim({
                ...latest,
                chip,
                filled: { ...latest.filled, claimType: CHIP_TYPE[chip] },
              });
            },
          })),
      });
    } else {
      say({ who: "wattle", checked, headline: missingText(missing) });
    }
    input.current?.focus();
  }

  function answerMissing(said: string) {
    const flow = flowNow.current;
    if (!flow?.filled || !flow.missing) return;
    me(said);
    const words = [...flow.words, said];
    if (flow.missing === "date") {
      // Only a day from the calendar, inside the trip; anything else asks again.
      const trip = records.policies.find((p) => p.policy_id === flow.policyId)?.trip;
      if (!dayInTrip(said, trip)) {
        say({
          who: "wattle",
          error: true,
          headline: trip
            ? `Pick the day from the calendar, between ${date(trip.departs_on)} and ${date(trip.returns_on)}.`
            : "Pick the day from the calendar.",
        });
      }
      continueClaim({ ...flow, filled: { ...flow.filled, incidentDate: said } });
    } else if (flow.missing === "place") {
      continueClaim({ ...flow, words, filled: { ...flow.filled, location: said } });
    } else if (flow.missing === "items" && amountsIn(said).length > 0) {
      // The customer's own amounts, read in code: no model needed, and nothing misread.
      continueClaim({ ...flow, words, filled: { ...flow.filled, lines: amountsIn(said) } });
    } else {
      // The assistant's own questions need reading again.
      void draftClaim({ ...flow, words }, []);
    }
  }

  async function send() {
    const current = flowNow.current;
    if (!current?.filled) return;
    if (busyNow.current || current.waiting !== "edit") return;
    me("Send claim");
    draftRun.current += 1;
    setFlow({ ...current, waiting: "none" });
    setBusyBoth("Sending your claim…");
    try {
      const made = await api.makeClaim(toNewClaim(current.policyId, current.filled));
      let filesSent = true;
      if (current.files.length > 0) {
        filesSent = await api.addReceipts(made.claim_id, current.files).then(
          () => true,
          () => false,
        );
      }
      void api.discardDraft().catch(() => undefined);
      setFlow(null);
      say({
        who: "wattle",
        headline: filesSent
          ? "Sent. We'll be in touch within two days."
          : "Sent, but your files didn't come through. Add them again from the claim.",
        card: { type: "claim", claimId: made.claim_id },
        choices: [
          {
            label: "Thanks",
            run: () => {
              me("Thanks");
            },
          },
        ],
      });
      onChanged();
    } catch (caught) {
      setFlow(current);
      say({
        who: "wattle",
        error: true,
        headline:
          caught instanceof ApiError ? caught.message : "Sorry, that didn't send. Try again?",
        choices: [
          {
            label: "Try again",
            run: () => {
              void send();
            },
          },
        ],
      });
    } finally {
      setBusyBoth(null);
    }
  }

  function resumeDraft() {
    const saved = records.draft?.draft;
    if (!saved) return;
    me("Finish my claim");
    if (!records.policies.some((p) => p.policy_id === saved.policy_id)) {
      askWhatHappened(latestPolicy(records.policies)?.policy_id ?? "");
      return;
    }
    const chip = (caseChips as readonly string[]).includes(saved.case)
      ? (saved.case as CaseChip)
      : "other";
    const next: Flow = {
      chip,
      policyId: saved.policy_id,
      words: saved.text ? [saved.text] : [],
      day: saved.incident_date,
      files: [],
      filled: saved.summary || saved.items.length > 0 ? restored(saved) : null,
      asked: new Set(),
      waiting: "files",
      missing: null,
    };
    setFlow(next);
    say({
      who: "wattle",
      headline: `Let's finish it. ${ASK_FOR_FILES[chip].replace(/^(Got it|I'm sorry|That's awful)\. /, "")}`,
      card: { type: "upload" },
      choices: [
        {
          label: "I don't have them yet",
          run: () => {
            me("I don't have them yet");
            void draftClaim(flowNow.current ?? next, []);
          },
        },
      ],
    });
  }

  async function claimDelay(offer: DelayOffer) {
    me("Claim it");
    setBusyBoth("Sending your claim…");
    try {
      const made = await api.claimDelay(offer.flight_id);
      say({
        who: "wattle",
        headline: "Sent. We'll be in touch soon.",
        card: { type: "claim", claimId: made.claim_id },
      });
      onChanged();
    } catch (caught) {
      say({
        who: "wattle",
        error: true,
        headline: caught instanceof ApiError ? caught.message : "Sorry, that didn't work.",
      });
    } finally {
      setBusyBoth(null);
    }
  }

  // --- Free questions go to Wattle ---

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || busyNow.current) return;
    me(trimmed);
    setBusyBoth("Looking into it…");
    try {
      const answer = await api.ask(trimmed, historyNow.current);
      historyNow.current = [
        ...historyNow.current,
        { role: "user" as const, text: trimmed },
        { role: "assistant" as const, text: answer.answer },
      ].slice(-8);
      answered(answer, trimmed);
    } catch (caught) {
      say({
        who: "wattle",
        error: true,
        headline:
          caught instanceof ApiError && caught.status === 429
            ? caught.message
            : "Sorry, that didn't work.",
        choices: [
          {
            label: "Try again",
            run: () => {
              void ask(trimmed);
            },
          },
          {
            label: "Talk to a person",
            run: () => {
              say({ who: "wattle", card: { type: "person" } });
            },
          },
        ],
      });
    } finally {
      setBusyBoth(null);
    }
  }

  function answered(answer: Answer, question: string) {
    const policy = latestPolicy(records.policies);
    const fromPolicy = answer.sources.some((s) => /policy wording/i.test(s));
    const replies: Choice[] = answer.replies.map((reply) => ({
      label: reply,
      run: () => {
        void ask(reply);
      },
    }));
    let card: Card | undefined;
    switch (answer.action) {
      case "show_claim":
        if (answer.claim_id) card = { type: "claim", claimId: answer.claim_id };
        break;
      case "show_claims":
        card = { type: "claims" };
        break;
      case "show_policy":
        if (policy) card = { type: "cover", policyId: policy.policy_id };
        break;
      case "settings":
        card = { type: "settings" };
        break;
      case "talk_to_person":
        card = { type: "person" };
        break;
      default:
        break;
    }
    say({
      who: "wattle",
      checked: fromPolicy ? "Checked your policy" : undefined,
      headline: answer.headline || answer.answer,
      points: answer.headline ? answer.points : [],
      policyChip: fromPolicy,
      card,
      choices: answer.action === "start_claim" ? [] : replies,
      voteOn: answer.screened ? undefined : question,
    });
    if (answer.action === "start_claim" && policy) {
      const chip = (caseChips as readonly string[]).includes(answer.claim_type)
        ? (answer.claim_type as CaseChip)
        : "other";
      startClaim(chip, policy.policy_id, false, [question]);
    }
  }

  // Something to start with, from the side panel or a link; once each, after the records load.
  const started = useRef<HomeProps["start"]>(null);
  useEffect(() => {
    if (!start || !loaded || started.current === start) return;
    started.current = start;
    if (start.kind === "claim") askWhatHappened(latestPolicy(records.policies)?.policy_id ?? "");
    else showCover(start.cover.policy_id, `Tell me about my ${planName(start.cover)} policy`);
    // Runs once per start; the handlers it calls change every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, loaded]);

  // --- The composer ---

  function submit() {
    const said = text.trim();
    if (!said || busyNow.current) return;
    setText("");
    const flow = flowNow.current;
    if (flow?.waiting === "first") answerFirst(said);
    else if (flow?.waiting === "missing") answerMissing(said);
    else if (flow?.waiting === "edit") {
      me(said);
      void draftClaim({ ...flow, words: [...flow.words, said] }, []);
    } else if (flow?.waiting === "files") {
      me(said);
      void draftClaim({ ...flow, words: [...flow.words, said] }, []);
    } else void ask(said);
  }

  const placeholder =
    flow && flow.waiting !== "none" ? "Type your answer" : "Ask anything, or tell us what happened";

  const composer = (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor={`${ids}-q`} className="visually-hidden">
        Message Wattle
      </label>
      <textarea
        id={`${ids}-q`}
        ref={input}
        rows={1}
        maxLength={500}
        placeholder={placeholder}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="composer-row">
        <input
          ref={files}
          type="file"
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          accept={RECEIPT_TYPES.join(",")}
          multiple
          onChange={(event) => {
            const chosen = Array.from(event.target.files ?? []);
            event.target.value = "";
            chooseFiles(chosen);
          }}
        />
        <input
          ref={camera}
          type="file"
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          accept="image/*"
          capture="environment"
          onChange={(event) => {
            const chosen = Array.from(event.target.files ?? []);
            event.target.value = "";
            chooseFiles(chosen);
          }}
        />
        <button
          type="button"
          className="composer-icon"
          aria-label="Add photos or files"
          disabled={busy !== null}
          onClick={() => {
            files.current?.click();
          }}
        >
          <Paperclip size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="composer-icon"
          aria-label="Take a photo"
          disabled={busy !== null}
          onClick={() => {
            camera.current?.click();
          }}
        >
          <Camera size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <span className="grow" />
        <button
          type="submit"
          className="composer-send"
          aria-label="Send"
          disabled={!text.trim() || busy !== null}
        >
          <ArrowUp size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </form>
  );

  const last = turns.length - 1;
  return (
    <div className={`home${empty ? " is-empty" : ""}`}>
      <div className="home-scroll">
        <div className="home-col">
          {empty ? (
            <section className="hello" aria-labelledby={`${ids}-hi`}>
              <WattleMark size={44} />
              <h1 id={`${ids}-hi`}>
                Hi <i>{firstName}.</i>
              </h1>
              <p className="hello-sub">What can we help with?</p>
              {news && <NewsLine news={news} onOpen={openNews} onDismiss={dismiss} />}
            </section>
          ) : (
            <h1 className="visually-hidden">Hi {firstName}</h1>
          )}
          {!empty && (
            <ol className="thread" aria-live="polite">
              {turns.map((turn, index) => (
                <li key={String(index)}>
                  {turn.who === "me" ? (
                    <MyTurn turn={turn} />
                  ) : (
                    <WattleTurn
                      turn={turn}
                      live={index === last && !busy}
                      api={api}
                      records={records}
                      flow={flow}
                      onOpen={onOpen}
                      onChanged={onChanged}
                      onFiles={chooseFiles}
                      onDate={(day) => {
                        answerMissing(day);
                      }}
                      onSend={() => {
                        void send();
                      }}
                      onEdit={() => {
                        me("Change something");
                        const now = flowNow.current;
                        if (now) setFlow({ ...now, waiting: "edit" });
                        say({ who: "wattle", headline: "Sure. What should I change?" });
                        input.current?.focus();
                      }}
                      onClaimDelay={(offer) => {
                        void claimDelay(offer);
                      }}
                      onPolicy={() => {
                        const policyId = policy();
                        if (policyId) onOpen({ view: "settings", policyId });
                      }}
                    />
                  )}
                </li>
              ))}
              {busy && (
                <li className="turn wattle" role="status">
                  <WattleMark size={28} working />
                  <p className="turn-working">{busy}</p>
                </li>
              )}
            </ol>
          )}
          <div ref={end} />
        </div>
      </div>
      <div className="dock">
        {composer}
        {empty && suggested.length > 0 && (
          <ul className="suggestions" aria-label="Suggestions">
            {suggested.map((s) => (
              <li key={s.label}>
                <button
                  type="button"
                  className="suggestion"
                  onClick={() => {
                    pick(s);
                  }}
                >
                  <span className="suggestion-icon" aria-hidden="true">
                    {s.kind === "trip" ? (
                      <Luggage size={18} strokeWidth={1.75} />
                    ) : s.kind === "claim" ? (
                      <FileText size={18} strokeWidth={1.75} />
                    ) : (
                      <Shield size={18} strokeWidth={1.75} />
                    )}
                  </span>
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        {!empty && <p className="dock-note">Wattle is AI · a person makes every final call</p>}
      </div>
    </div>
  );

  function policy(): string | undefined {
    return flowNow.current?.policyId ?? latestPolicy(records.policies)?.policy_id;
  }
}

function NewsLine({
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

function MyTurn({ turn }: { turn: Extract<Turn, { who: "me" }> }) {
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
  onEdit: () => void;
  onClaimDelay: (offer: DelayOffer) => void;
  onPolicy: () => void;
}

function WattleTurn(props: WattleTurnProps) {
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
                {bolded(point.text)}
              </li>
            ))}
          </ul>
        )}
        {turn.policyChip && (
          <button type="button" className="source-chip" onClick={onPolicy}>
            <FileText size={13} strokeWidth={1.75} aria-hidden="true" /> Your policy
          </button>
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
  onEdit,
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
    case "check":
      return flow?.filled ? (
        <CardShell>
          <p className="card-title" dir="auto">
            {flow.filled.summary}
          </p>
          <p className="card-meta" dir="auto">
            {flow.filled.location} · {date(flow.filled.incidentDate)}
          </p>
          <ul className="card-lines">
            {flow.filled.lines.map((line, i) => (
              <li key={String(i)}>
                <span dir="auto">{line.description}</span>
                <span>{dollars(line.amount)}</span>
              </li>
            ))}
          </ul>
          <div className="card-figures one">
            <div>
              <small>You&apos;re claiming</small>
              <b>{dollars(total(flow.filled.lines))}</b>
            </div>
          </div>
          {live && flow.waiting === "edit" && (
            <div className="card-actions">
              <button type="button" className="button" onClick={onSend}>
                Send claim
              </button>
              <button type="button" className="text-link" onClick={onEdit}>
                Change something
              </button>
            </div>
          )}
        </CardShell>
      ) : null;
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
  const [claim, setClaim] = useState<CustomerClaim | null>(null);
  const [failed, setFailed] = useState(false);
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
  }, [api, claimId]);
  if (failed) return <p className="card-meta">I couldn&apos;t load that claim.</p>;
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

function NeedsCard({
  api,
  claimId,
  onChanged,
}: {
  api: Api;
  claimId: string;
  onChanged: () => void;
}) {
  const [claim, setClaim] = useState<CustomerClaim | null>(null);
  useEffect(() => {
    let live = true;
    api.myClaim(claimId).then(
      (found) => {
        if (live) setClaim(found);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api, claimId]);
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
    <CardShell>
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
    </CardShell>
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
