// A claim made by chat, steered by code: one question at a time, never asking what the records
// already say. The drafting assistant reads the customer's words and receipts; code decides what
// is still missing and asks for it, and nothing is sent until the customer taps Send claim.
import type { CaseChip, ClaimDraft, Draft, NewClaim, Policy } from "../api";

export const CHIP_LABEL: Record<CaseChip, string> = {
  lost_bag: "Lost bag",
  delayed_bag: "Bag arrived late",
  flight_delay: "Delayed flight",
  trip_cancelled: "Trip cancelled",
  medical: "Medical",
  stolen: "Something stolen",
  passport: "Lost passport",
  other: "Something else",
};

/** The claim type each kind of trouble is made as; "other" lets the assistant suggest one. */
export const CHIP_TYPE: Record<CaseChip, string> = {
  lost_bag: "baggage",
  delayed_bag: "baggage_delay",
  flight_delay: "trip_delay",
  trip_cancelled: "trip_cancellation",
  medical: "emergency_medical",
  stolen: "baggage",
  passport: "passport",
  other: "",
};

export interface Reply {
  label: string;
  /** What the customer's tap adds to their words. */
  says: string;
  /** The day it pins down, when the trip's dates do. */
  day?: string;
}

export interface Question {
  text: string;
  replies: Reply[];
}

/** The first thing to ask for each kind of trouble: only what the records can't say. */
export function firstQuestion(chip: CaseChip, policy: Policy): Question {
  const out = policy.trip.departs_on;
  const home = policy.trip.returns_on;
  const legs: Reply[] = [
    { label: "Flying out", says: "It happened flying out.", day: out },
    { label: "During the trip", says: "It happened during the trip." },
    { label: "Flying home", says: "It happened flying home.", day: home },
  ];
  switch (chip) {
    case "lost_bag":
      return { text: "When did it go missing?", replies: legs };
    case "delayed_bag":
      return {
        text: "When was it late?",
        replies: [legs[0] as Reply, { label: "Another flight", says: "It was on another flight." }],
      };
    case "flight_delay":
      return {
        text: "Which flight was it?",
        replies: [
          { label: "Flying out", says: "The flight out was delayed.", day: out },
          { label: "Flying home", says: "The flight home was delayed.", day: home },
          { label: "Another flight", says: "Another flight on the trip was delayed." },
        ],
      };
    case "trip_cancelled":
      return {
        text: "Why couldn't you go?",
        replies: [
          { label: "I got sick", says: "I couldn't go because I got sick." },
          { label: "Family emergency", says: "I couldn't go because of a family emergency." },
          { label: "The trip was cancelled", says: "The trip was cancelled." },
        ],
      };
    case "medical":
      return { text: "What happened, and where were you treated?", replies: [] };
    case "stolen":
      return { text: "What was taken, and where were you?", replies: [] };
    case "passport":
      return { text: "Where did you lose it?", replies: [] };
    case "other":
      return { text: "Tell me what happened, in a line or two.", replies: [] };
  }
}

/** What to send for each kind of trouble, in one plain line. */
export const ASK_FOR_FILES: Record<CaseChip, string> = {
  lost_bag: "Got it. Send me the airline's report and any receipts you have.",
  delayed_bag: "Got it. Send me the airline's report and receipts for what you had to buy.",
  flight_delay: "Got it. Send me your booking and any receipts for meals, transport or a hotel.",
  trip_cancelled:
    "I'm sorry. Send me your booking and anything that shows why, like a doctor's letter.",
  medical: "I'm sorry. Send me the doctor's report and the bills.",
  stolen: "That's awful. Send me the police report and any receipts for what was taken.",
  passport: "Send me the police report and receipts for the new passport.",
  other: "Send me anything that shows what happened, and receipts for what you paid.",
};

export interface Line {
  description: string;
  category: string;
  amount: number;
}

/** The claim as it stands, from the assistant's draft and what the customer said. */
export interface Filled {
  claimType: string;
  summary: string;
  story: string;
  incidentDate: string;
  location: string;
  lines: Line[];
  /** What the assistant still wants to know, in the customer's terms. */
  questions: string[];
}

// Text written about the customer or the draft, never for them. The agent filters these too;
// this keeps them off the screen even if one slips through.
const NOTE =
  /\b(the customer|customer has|claimant|the user|draft|pending|not yet (described|provided|selected|given)|no (information|details) (was |were )?provided|unknown|n\/a)\b/i;
// Questions code asks itself, in its own words.
const OWN =
  /\b(type of (claim|problem)|kind of (claim|problem)|what type|when did|what date|which date|where did|where were|what (city|country|place)|how much|amount|cost|item)\b/i;

/** Whether text reads as an assistant's internal note rather than the customer's own words. */
export function isNote(text: string): boolean {
  return NOTE.test(text);
}

const clean = (text: string | undefined) => (text && !isNote(text) ? text : "");
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function fill(draft: Draft | null, chip: CaseChip, words: string[], day = ""): Filled {
  const said = words.join(" ").trim();
  return {
    claimType: CHIP_TYPE[chip] || draft?.claim_type || "",
    summary: clean(draft?.summary) || CHIP_LABEL[chip],
    // The customer's own words are the record; the assistant's story only fills a blank.
    story: said || clean(draft?.story),
    incidentDate: ISO_DAY.test(draft?.incident_date ?? "") ? (draft?.incident_date ?? "") : day,
    location: clean(draft?.incident_location),
    lines: (draft?.items ?? [])
      .filter((item) => item.amount > 0)
      .map(({ description, category, amount }) => ({ description, category, amount })),
    questions: (draft?.missing_questions ?? [])
      .filter((q) => !isNote(q) && !OWN.test(q))
      .slice(0, 1),
  };
}

export type Missing = "date" | "place" | "items" | "type" | { question: string };

/** Whether a day is a real calendar day inside the trip; with no trip, any real day. */
export function dayInTrip(
  day: string,
  trip?: Pick<Policy["trip"], "departs_on" | "returns_on">,
): boolean {
  if (!ISO_DAY.test(day) || Number.isNaN(Date.parse(day))) return false;
  return !trip || (day >= trip.departs_on && day <= trip.returns_on);
}

/** The one thing still needed before the claim can be sent, or null when it's ready. */
export function nextMissing(
  filled: Filled,
  asked: ReadonlySet<string>,
  trip?: Pick<Policy["trip"], "departs_on" | "returns_on">,
): Missing | null {
  if (!dayInTrip(filled.incidentDate, trip)) return "date";
  if (!filled.location.trim()) return "place";
  if (filled.lines.length === 0) return "items";
  if (!filled.claimType) return "type";
  const question = filled.questions.find((q) => !asked.has(q));
  return question ? { question } : null;
}

/** The question for what's missing; asked again, it says what would do, never the same words. */
const MISSING_AGAIN: Record<Exclude<Missing, object>, string> = {
  date: "Sorry, I still need the day. Pick it below.",
  place: "Where exactly? An airport, hotel or city is fine.",
  items: 'I need a rough amount for each thing, like "$120 sunglasses, $60 shoes".',
  type: "Which of these is it closest to?",
};

export function missingText(missing: Missing, again = false): string {
  if (typeof missing === "object") return missing.question;
  if (again) return MISSING_AGAIN[missing];
  switch (missing) {
    case "date":
      return "What day did it happen?";
    case "place":
      return "Where were you when it happened?";
    case "items":
      return "What are you claiming for, and roughly how much was each thing?";
    case "type":
      return "Which of these is it closest to?";
  }
}

/** What the customer said they paid, read in code from their own words: "the clinic $120 and
 * medicine $45" is two lines. Empty when there's no amount to read. */
export function amountsIn(said: string): Line[] {
  const lines: Line[] = [];
  const pattern =
    /([^$\d]*?)(\$?)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?![\d.]|st|nd|rd|th)/g;
  const found = [...said.matchAll(pattern)];
  // "2 bags, $120" is one amount: with any $ in the message, only numbers with one count.
  const dollars = found.some((match) => match[2] === "$");
  for (const match of found) {
    if (dollars && match[2] !== "$") continue;
    const amount = Number((match[3] ?? "").replace(/,/g, ""));
    if (!(amount > 0)) continue;
    const description = (match[1] ?? "")
      .replace(/^[\s,;:.-]*(and|plus)?\s*/i, "")
      .replace(/[\s,;:.-]*(was|cost|for|of|about|roughly)?\s*$/i, "")
      .trim();
    lines.push({ description: description || "What I paid for", category: "other", amount });
  }
  return lines;
}

/** A claim saved to finish later, as far as it got. */
export function restored(saved: ClaimDraft): Filled {
  return {
    claimType: saved.claim_type,
    summary: saved.summary,
    story: saved.story || saved.text,
    incidentDate: saved.incident_date,
    location: saved.incident_location,
    lines: saved.items
      .map((item) => ({ ...item, amount: Number(item.amount) }))
      .filter((item) => item.amount > 0),
    questions: [],
  };
}

export function total(lines: Line[]): number {
  return Math.round(lines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100;
}

export function toNewClaim(policyId: string, filled: Filled): NewClaim {
  return {
    policy_id: policyId,
    claim_type: filled.claimType,
    incident_date: filled.incidentDate,
    incident_location: filled.location.trim(),
    summary: filled.summary.trim().slice(0, 200),
    story: filled.story.trim() || filled.summary.trim(),
    items: filled.lines.map((line) => ({
      ...line,
      description: line.description.trim(),
      amount: Math.round(line.amount * 100) / 100,
    })),
  };
}

/** The claim so far, kept to finish later. */
export function toSaved(
  policyId: string,
  chip: CaseChip,
  words: string[],
  filled: Filled | null,
): ClaimDraft {
  return {
    policy_id: policyId,
    case: chip,
    text: words.join(" ").slice(0, 2000),
    claim_type: filled?.claimType ?? CHIP_TYPE[chip],
    summary: filled?.summary ?? "",
    story: filled?.story ?? "",
    incident_date: filled?.incidentDate ?? "",
    incident_location: filled?.location ?? "",
    items: (filled?.lines ?? []).map((line) => ({ ...line, amount: line.amount.toFixed(2) })),
    step: filled ? "check" : "what",
  };
}
