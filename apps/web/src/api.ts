/*
 * The one module that talks to the api, and the types of everything it returns.
 *
 * Assumed contract (written before the api's routes exist; reconcile here only):
 * - Every route is under /api and takes `Authorization: Bearer <token>`, except sign-in.
 * - Field names follow the course's records: claim_id, submitted_on, amount_claimed, ...
 * - Errors are FastAPI's `{"detail": "..."}`; a 403's detail says what the handler can't do.
 * - GET /api/me returns the signed-in handler, with can_approve_over_limit.
 * - GET /api/claims/{id} includes the claim's policy, its decision (or null), its payment
 *   (or null), the decisions sent back, and the approval limit in force.
 * - A decision the hidden-instruction check made has by_screening: true.
 * - GET /api/claims/{id}/steps returns the steps oldest first; the check's step comes first.
 * - POST /api/claims/{id}/work, /sign-off and /send-back return the claim as it now stands.
 */

export interface Source {
  file: string;
  system: string;
  owner: string;
  reviewed: string;
}

export const statuses = [
  "waiting",
  "in_progress",
  "waiting_for_sign_off",
  "sent_back",
  "decided",
  "left_for_handler",
] as const;
export type Status = (typeof statuses)[number];
export type DecisionKind = "approve" | "decline" | "refer";
export type StepKind =
  | "screening"
  | "message"
  | "tool_call"
  | "tool_result"
  | "lookup"
  | "refusal"
  | "error"
  | "sent_back";

export interface Handler {
  handler_id: string;
  name: string;
  email: string;
  role: string;
  can_approve_over_limit: boolean;
}

export interface ClaimSummary {
  claim_id: string;
  customer_name: string;
  plan: string;
  claim_type: string;
  summary: string;
  amount_claimed: number;
  submitted_on: string;
  status: Status;
}

export interface Item {
  description: string;
  category: string;
  amount: number;
}

export interface ClaimDocument {
  name: string;
  type: string;
  content: string;
}

export interface PolicySummary {
  policy_id: string;
  plan: string;
  add_ons: string[];
  destination: string;
  trip_start: string;
  trip_end: string;
  travelers: number;
}

export interface CalculationStep {
  step: string;
  amount: number;
}

export interface Decision {
  decision: DecisionKind;
  payout: number;
  calculation: CalculationStep[];
  section: string;
  reason: string;
  decided_by: string;
  decided_at: string;
  manual_version: string;
  by_screening: boolean;
}

export interface SentBackDecision {
  decision: Decision;
  note: string;
  sent_back_by: string;
  sent_back_at: string;
}

export interface Payment {
  amount: number;
  paid_at: string;
  signed_off_by: string | null;
}

export interface Claim extends ClaimSummary {
  incident_date: string;
  incident_location: string;
  story: string;
  items: Item[];
  documents: ClaimDocument[];
  policy: PolicySummary;
  decision: Decision | null;
  payment: Payment | null;
  sent_back_decisions: SentBackDecision[];
  approval_limit: number;
}

export interface Step {
  step_id: number;
  kind: StepKind;
  content: string;
  sources: Source[];
  at: string;
}

export const NOTE_LIMIT = 1000;

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface Api {
  signIn: (email: string, password: string) => Promise<string>;
  me: () => Promise<Handler>;
  listClaims: () => Promise<ClaimSummary[]>;
  getClaim: (claimId: string) => Promise<Claim>;
  listSteps: (claimId: string) => Promise<Step[]>;
  workClaim: (claimId: string) => Promise<Claim>;
  signOff: (claimId: string) => Promise<Claim>;
  sendBack: (claimId: string, note: string) => Promise<Claim>;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const FALLBACK_ERROR = "Something went wrong talking to the server. Please try again.";

async function errorFrom(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return new ApiError(response.status, body.detail);
  } catch {
    // Not JSON: fall back to the plain message below.
  }
  return new ApiError(response.status, FALLBACK_ERROR);
}

export function createApi(fetchFn: Fetch, getToken: () => string | null): Api {
  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetchFn(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw await errorFrom(response);
    return (await response.json()) as T;
  }

  const claimPath = (claimId: string) => `/claims/${encodeURIComponent(claimId)}`;

  return {
    signIn: async (email, password) => {
      const answer = await call<{ access_token: string }>("POST", "/dev/sign-in", {
        email,
        password,
      });
      return answer.access_token;
    },
    me: () => call("GET", "/me"),
    listClaims: () => call("GET", "/claims"),
    getClaim: (claimId) => call("GET", claimPath(claimId)),
    listSteps: (claimId) => call("GET", `${claimPath(claimId)}/steps`),
    workClaim: (claimId) => call("POST", `${claimPath(claimId)}/work`),
    signOff: (claimId) => call("POST", `${claimPath(claimId)}/sign-off`),
    sendBack: (claimId, note) => call("POST", `${claimPath(claimId)}/send-back`, { note }),
  };
}
