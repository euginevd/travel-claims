// Test helpers: data shaped like the api's responses (src/fixtures/ holds real ones, which
// api.contract.test.ts checks), and a fake fetch that answers by route.
import type { Customer, CustomerClaim, CustomerClaimSummary, Policy } from "./api";

export const MAYA: Customer = {
  customer_id: "CUS-3001",
  name: "Maya Patel",
  email: "maya.patel@example.com",
};

export const MY_POLICY: Policy = {
  policy_id: "POL-2001",
  plan: "premium",
  add_ons: [],
  purchased_on: "2026-04-22",
  trip: {
    destination: "Rome, Italy",
    departs_on: "2026-06-10",
    returns_on: "2026-06-18",
    trip_cost: 3100,
  },
  travelers: ["Maya Patel"],
};

export const MY_SUMMARY: CustomerClaimSummary = {
  claim_id: "CLM-1001",
  policy_id: "POL-2001",
  claim_type: "trip_delay",
  summary: "Flight home canceled by the airline",
  amount_claimed: 420,
  submitted_on: "2026-06-24",
  status: "received",
  status_text: "Received. We'll start looking at it shortly.",
};

export function myClaim(overrides: Partial<CustomerClaim> = {}): CustomerClaim {
  return {
    ...MY_SUMMARY,
    incident_date: "2026-06-18",
    incident_location: "Rome, Italy",
    story: "My flight home from Rome was cancelled.",
    items: [{ description: "Airport hotel, one night", category: "accommodation", amount: 245 }],
    outcome: null,
    reason: null,
    paid: null,
    paid_at: null,
    receipts: [],
    can_add_receipts: true,
    review_requested: false,
    can_request_review: false,
    ...overrides,
  };
}

type Answer = [status: number, body: unknown];
export type Routes = Record<string, (body: unknown) => Answer>;

export interface FakeFetch {
  (input: string, init?: RequestInit): Promise<Response>;
  calls: { method: string; path: string; body: unknown; auth: string | null }[];
}

// Answers `${method} ${path}` from the routes; anything else is a 404.
export function fakeFetch(routes: Routes): FakeFetch {
  const calls: FakeFetch["calls"] = [];
  const fetchFn = (input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body: unknown =
      typeof init?.body === "string" ? JSON.parse(init.body) : (init?.body ?? undefined);
    const headers = new Headers(init?.headers);
    calls.push({ method, path: input, body, auth: headers.get("Authorization") });
    const route = routes[`${method} ${input}`];
    const [status, answer] = route ? route(body) : [404, { detail: "Not found" }];
    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  return Object.assign(fetchFn, { calls });
}
