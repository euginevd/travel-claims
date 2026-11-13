// What the customer sees on arrival: at most one line of news, and three suggestions, all picked
// in code from their own records so they're instant and cost nothing.
import type { CustomerClaimSummary, DelayOffer, Policy, SavedDraft } from "../api";
import { dollars } from "../format";

export interface News {
  /** Remembered when dismissed: one claim's one event. */
  key: string;
  tone: "need" | "good" | "plain";
  title: string;
  detail: string;
  /** What tapping it does. */
  go: { to: "claim"; claimId: string } | { to: "draft" } | { to: "delay"; offer: DelayOffer };
  action: string;
  /** Something we need comes back next visit even if dismissed; news stays dismissed. */
  sticky: boolean;
}

/** The claim in a word or two, as a customer would say it: "your passport claim". */
export const CLAIM_NOUN: Record<string, string> = {
  baggage: "bag",
  baggage_delay: "late bag",
  trip_delay: "delay",
  trip_cancellation: "cancellation",
  trip_interruption: "trip",
  passport: "passport",
  emergency_medical: "medical",
};

export function noun(claim: Pick<CustomerClaimSummary, "claim_type">): string {
  return CLAIM_NOUN[claim.claim_type] ?? "";
}

function yourClaim(claim: CustomerClaimSummary): string {
  const word = noun(claim);
  return word ? `your ${word} claim` : "your claim";
}

const DONE = new Set(["paid", "declined"]);

/** The one thing worth saying on arrival, most important first: something we need, a claim
 * they didn't send, a delay they can claim, then a claim's news. Null when there's nothing. */
export function pickNews(
  claims: CustomerClaimSummary[],
  delays: DelayOffer[],
  draft: SavedDraft | null,
  dismissed: ReadonlySet<string>,
): News | null {
  const candidates: News[] = [];
  for (const claim of claims.filter((c) => c.open_requests > 0)) {
    candidates.push({
      key: `need:${claim.claim_id}`,
      tone: "need",
      title: `We need ${claim.open_requests === 1 ? "one thing" : `${String(claim.open_requests)} things`} for ${yourClaim(claim)}`,
      detail: claim.summary,
      go: { to: "claim", claimId: claim.claim_id },
      action: "Send it",
      sticky: true,
    });
  }
  if (draft) {
    candidates.push({
      key: `draft:${draft.updated_at}`,
      tone: "plain",
      title: "You have a claim you haven't sent",
      detail: draft.draft.summary || draft.draft.text || "Started earlier",
      go: { to: "draft" },
      action: "Finish it",
      sticky: false,
    });
  }
  for (const offer of delays) {
    candidates.push({
      key: `delay:${offer.flight_id}`,
      tone: "good",
      title: `Your flight ${offer.flight} was late enough to claim`,
      detail: `${offer.route} · about ${dollars(offer.estimate)}`,
      go: { to: "delay", offer },
      action: "Claim it",
      sticky: false,
    });
  }
  const newest = [...claims].sort((a, b) => b.submitted_on.localeCompare(a.submitted_on));
  for (const claim of newest) {
    if (claim.status === "paid" || claim.status === "approved" || claim.status === "declined") {
      const word = claim.status === "declined" ? "decided" : claim.status;
      candidates.push({
        key: `${claim.status}:${claim.claim_id}`,
        tone: claim.status === "declined" ? "plain" : "good",
        title: `${yourClaim(claim).replace(/^y/, "Y")} is ${word}`,
        detail: claim.status_text,
        go: { to: "claim", claimId: claim.claim_id },
        action: "See",
        sticky: false,
      });
    }
  }
  return candidates.find((news) => !dismissed.has(news.key)) ?? null;
}

export type Suggestion =
  | { kind: "trip"; label: string; policyId: string }
  | { kind: "claim"; label: string; claimId: string }
  | { kind: "cover"; label: string; policyId: string };

/** The latest trip: the one on now or most recently started. */
export function latestPolicy(policies: Policy[]): Policy | undefined {
  return [...policies].sort((a, b) => b.trip.departs_on.localeCompare(a.trip.departs_on))[0];
}

/** Three suggestions from their records: the latest trip, an open claim the news line doesn't
 * already cover, and their cover. */
export function suggestions(
  policies: Policy[],
  claims: CustomerClaimSummary[],
  news: News | null,
): Suggestion[] {
  const out: Suggestion[] = [];
  const trip = latestPolicy(policies);
  if (trip) {
    out.push({
      kind: "trip",
      label: `Something went wrong in ${place(trip.trip.destination)}`,
      policyId: trip.policy_id,
    });
  }
  const covered = news?.go.to === "claim" ? news.go.claimId : null;
  const open = claims.find((c) => !DONE.has(c.status) && c.claim_id !== covered);
  if (open) {
    out.push({
      kind: "claim",
      label: `How's ${yourClaim(open)} going?`,
      claimId: open.claim_id,
    });
  }
  if (trip) out.push({ kind: "cover", label: "What am I covered for?", policyId: trip.policy_id });
  return out;
}

/** A destination as people say it: "Bentota, Sri Lanka" is "Bentota". */
export function place(destination: string): string {
  return destination.split(/,| and /)[0]?.trim() || destination;
}

export const DISMISSED_KEY = "undercover.dismissed";

/** The news the customer dismissed for good, from this browser. */
export function loadDismissed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((k) => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveDismissed(keys: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify([...keys].slice(-100)));
  } catch {
    // Without storage the line simply comes back next visit.
  }
}
