import { ArrowUp, Camera, FileText, Paperclip, Plus, Shield, Luggage } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  ApiError,
  caseChips,
  type Answer,
  type Api,
  type AskTurn,
  type CaseChip,
  type Cover,
  type DelayOffer,
} from "../api";
import { MAX_RECEIPTS, receiptProblem, RECEIPT_TYPES } from "./receipts";
import { WattleMark } from "../components/Wattle";
import { date } from "../format";
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
  type Filled,
  type Reply,
} from "./claimFlow";
import { coverLine, planName } from "./cover";
import { Glance } from "./Glance";
import { useDraftSaves } from "./useDraftSaves";
import { useMedia } from "./useMedia";
import type { Records } from "./records";
import type { PanelTarget } from "./SidePanel";
import {
  lowerFirst,
  MyTurn,
  NewsLine,
  WattleTurn,
  type Card,
  type Choice,
  type Flow,
  type Turn,
} from "./Turns";

interface HomeProps {
  api: Api;
  firstName: string;
  records: Records;
  loaded: boolean;
  onOpen: (target: PanelTarget) => void;
  onChanged: () => void;
  /** Something to start with, set from outside the conversation. */
  start: { kind: "claim" } | { kind: "policy"; cover: Cover } | null;
  /** Goes up by one each time the customer presses Home. */
  homeTick?: number;
  /** Clears this conversation for a fresh one. */
  onNewChat?: () => void;
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

export function Home({
  api,
  firstName,
  records,
  loaded,
  onOpen,
  onChanged,
  start,
  homeTick = 0,
  onNewChat,
}: HomeProps) {
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
  const drafts = useDraftSaves(api);
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed);
  // Something we need comes back next visit, so it's hidden for this visit only.
  const [hiddenNow, setHiddenNow] = useState<Set<string>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);

  const empty = turns.length === 0;
  // Home shows the start screen over a conversation, which is kept to go back to.
  const [showHome, setShowHome] = useState(false);
  const [seenTick, setSeenTick] = useState(homeTick);
  if (homeTick !== seenTick) {
    setSeenTick(homeTick);
    setShowHome(true);
  }
  const atHome = empty || showHome;
  // A phone puts the key facts in the scrolling page, not under the composer.
  const narrow = useMedia("(max-width: 640px)");
  const glance = atHome && loaded && <Glance records={records} onOpen={onOpen} />;
  const returning = useRef(false);
  const shownTurns = useRef(0);
  const news = loaded
    ? pickNews(records.claims, records.delays, records.draft, new Set([...dismissed, ...hiddenNow]))
    : null;
  const suggested = loaded ? suggestions(records.policies, records.claims, news) : [];

  // What the customer just said goes to the top of the screen, with Wattle's reply below it to
  // read from the start. The space under the thread is only what that needs.
  useLayoutEffect(() => {
    const box = scroller.current;
    const pad = spacer.current;
    if (!box || !pad) return;
    pad.style.height = "0px";
    const mine = box.querySelectorAll<HTMLElement>(".thread > li.is-me");
    const latest = mine[mine.length - 1];
    if (!latest) return;
    const top =
      latest.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 16;
    pad.style.height = `${String(Math.max(0, box.clientHeight - (box.scrollHeight - top)))}px`;
    // Also when something above it closed (a sent claim's check card) and pushed it out of sight.
    const added = turns.length > shownTurns.current;
    shownTurns.current = turns.length;
    const hidden = added && latest.getBoundingClientRect().top < box.getBoundingClientRect().top;
    const back = returning.current;
    returning.current = false;
    if ((turns.at(-1)?.who === "me" || hidden || back) && typeof box.scrollTo === "function")
      box.scrollTo({ top, behavior: hidden || back ? "auto" : "smooth" });
  }, [turns, busy, showHome]);

  const say = (turn: Turn) => {
    setShowHome(false);
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

  /** Something else started: typing no longer answers the claim in progress. */
  function leaveFlow() {
    if (flowNow.current && flowNow.current.waiting !== "none") setFlow(null);
  }

  function openNews(item: News) {
    if (item.go.to !== "draft") leaveFlow();
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
    leaveFlow();
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
    const covered = Boolean(cover && chip !== "other");
    say({
      who: "wattle",
      checked: covered ? "Checked your policy" : undefined,
      headline: intro
        ? chip === "other"
          ? "Let's sort it out."
          : `Sorry ${firstName}, let's sort it out.`
        : undefined,
      lines: [
        ...(cover && covered
          ? [
              `On your ${place(policy.trip.destination)} trip, ${lowerFirst(coverLine(cover, chip))}`,
            ]
          : []),
        question.text,
      ],
      policyChip: covered,
      trip: {
        label: `${place(policy.trip.destination)} trip`,
        change:
          records.policies.length > 1
            ? () => {
                pickTrip(chip, words);
              }
            : undefined,
      },
      choices: question.replies.map((reply) => ({
        label: reply.label,
        run: () => {
          answerFirst(reply.says, reply);
        },
      })),
    });
  }

  function pickTrip(chip: CaseChip, words: string[]) {
    me("Change the trip");
    setFlow(null);
    say({
      who: "wattle",
      headline: "Which trip was it?",
      choices: records.policies.map((p) => {
        const label = `${place(p.trip.destination)} · ${date(p.trip.departs_on)}`;
        return {
          label,
          run: () => {
            me(label);
            startClaim(chip, p.policy_id, false, words);
          },
        };
      }),
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
    drafts.save(toSaved(next.policyId, next.chip, next.words, null));
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
    drafts.save(toSaved(current.policyId, current.chip, current.words, current.filled));
    const trip = records.policies.find((p) => p.policy_id === current.policyId)?.trip;
    const missing = nextMissing(current.filled, current.asked, trip);
    if (!missing) {
      setFlow({ ...current, waiting: "edit", missing: null });
      say({
        who: "wattle",
        checked,
        headline: "All set. Happy for me to send this?",
        card: { type: "check", filled: current.filled },
      });
      return;
    }
    const asked =
      typeof missing === "object" ? new Set([...current.asked, missing.question]) : current.asked;
    const again = current.missing === missing;
    setFlow({ ...current, asked, waiting: "missing", missing });
    const policy = records.policies.find((p) => p.policy_id === current.policyId);
    if (missing === "date" && policy) {
      say({
        who: "wattle",
        checked,
        headline: missingText(missing, again),
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
      say({ who: "wattle", checked, headline: missingText(missing, again) });
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
          card: trip ? { type: "date", min: trip.departs_on, max: trip.returns_on } : undefined,
        });
        return;
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
    drafts.sending(true);
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
      void drafts.discard();
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
      drafts.sending(false);
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
    // Starting a claim: straight into it, one warm turn, without the general answer before it.
    if (answer.action === "start_claim" && policy) {
      const chip = (caseChips as readonly string[]).includes(answer.claim_type)
        ? (answer.claim_type as CaseChip)
        : "other";
      startClaim(chip, policy.policy_id, true, [question]);
      return;
    }
    say({
      who: "wattle",
      checked: fromPolicy ? "Checked your policy" : undefined,
      headline: answer.headline || answer.answer,
      points: answer.headline ? answer.points : [],
      policyChip: fromPolicy,
      card,
      choices: replies,
      voteOn: answer.screened ? undefined : question,
    });
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
    // Typed on the start screen: a new question, not an answer to the claim left in the chat.
    if (showHome) leaveFlow();
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
        {!empty && onNewChat && (
          <button type="button" className="composer-new" onClick={onNewChat}>
            <Plus size={16} strokeWidth={2} aria-hidden="true" /> New chat
          </button>
        )}
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
    <div className={`home${atHome ? " is-empty" : ""}`}>
      <div className="home-scroll" ref={scroller}>
        <div className="home-col">
          {atHome ? (
            <section className="hello" aria-labelledby={`${ids}-hi`}>
              <WattleMark size={44} />
              <h1 id={`${ids}-hi`}>
                Hi <i>{firstName}.</i>
              </h1>
              <p className="hello-sub">What can we help with?</p>
              {news && <NewsLine news={news} onOpen={openNews} onDismiss={dismiss} />}
              {!empty && (
                <button
                  type="button"
                  className="button secondary back-to-chat"
                  onClick={() => {
                    returning.current = true;
                    setShowHome(false);
                  }}
                >
                  Back to your chat
                </button>
              )}
              {narrow && glance}
            </section>
          ) : (
            <h1 className="visually-hidden">Hi {firstName}</h1>
          )}
          {!atHome && (
            <ol className="thread" aria-live="polite">
              {turns.map((turn, index) => (
                <li key={String(index)} className={turn.who === "me" ? "is-me" : undefined}>
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
                      onSaveCheck={(filled) => {
                        const now = flowNow.current;
                        if (!now) return;
                        setFlow({ ...now, filled });
                        setTurns((all) => {
                          const at = all.findLastIndex(
                            (t) => t.who === "wattle" && t.card?.type === "check",
                          );
                          return all.map((t, i) =>
                            i === at && t.who === "wattle"
                              ? { ...t, card: { type: "check", filled } }
                              : t,
                          );
                        });
                        drafts.save(toSaved(now.policyId, now.chip, now.words, filled));
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
          <div ref={spacer} aria-hidden="true" />
        </div>
      </div>
      <div className="dock">
        {composer}
        {atHome && suggested.length > 0 && (
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
        {!narrow && glance}
        {!atHome && <p className="dock-note">Wattle is AI · a person makes every final call</p>}
      </div>
    </div>
  );

  function policy(): string | undefined {
    return flowNow.current?.policyId ?? latestPolicy(records.policies)?.policy_id;
  }
}
