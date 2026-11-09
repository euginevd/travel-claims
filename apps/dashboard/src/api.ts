/*
 * The one module that talks to the api. Every response is checked against a schema here, at
 * the boundary, so nothing the rest of the app renders can have the wrong shape; the types
 * come from the schemas. The api's own models are in apps/api/src/undercover_api/models.py,
 * and src/fixtures/ holds real responses from it that the tests parse.
 */
import { z } from "zod";

export const statuses = [
  "waiting",
  "in_progress",
  "waiting_for_sign_off",
  "sent_back",
  "decided",
  "left_for_handler",
] as const;
const StatusSchema = z.enum(statuses);
const DecisionKindSchema = z.enum(["approve", "decline", "refer"]);
const StepKindSchema = z.enum([
  "screening",
  "message",
  "tool_call",
  "tool_result",
  "lookup",
  "refusal",
  "error",
  "sent_back",
]);

const SourceSchema = z.object({
  file: z.string(),
  system: z.string(),
  owner: z.string(),
  reviewed: z.string(),
});

export const HandlerSchema = z.object({
  handler_id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  can_approve_over_limit: z.boolean(),
});

export const ClaimSummarySchema = z.object({
  due_on: z.string(),
  documents_in: z.boolean(),
  claim_id: z.string(),
  customer_name: z.string(),
  plan: z.string(),
  claim_type: z.string(),
  summary: z.string(),
  amount_claimed: z.number(),
  submitted_on: z.string(),
  status: StatusSchema,
  decision: DecisionKindSchema.nullable(),
  payout: z.number().nullable(),
  review_requested: z.boolean(),
});

const PolicySchema = z.object({
  policy_id: z.string(),
  plan: z.string(),
  add_ons: z.array(z.string()),
  purchased_on: z.string(),
  trip: z.object({
    destination: z.string(),
    departs_on: z.string(),
    returns_on: z.string(),
    trip_cost: z.number(),
  }),
  travelers: z.array(z.string()),
});

const CalculationStepSchema = z.object({ step: z.string(), amount: z.number() });

export const ReceiptSchema = z.object({
  receipt_id: z.string(),
  media_type: z.string(),
  size: z.number(),
  uploaded_at: z.string(),
});

const ItemSchema = z.object({ description: z.string(), category: z.string(), amount: z.number() });

export const reasonCodes = [
  "policy_wording",
  "evidence",
  "calculation",
  "customer_circumstances",
  "suspected_fraud",
  "other",
] as const;
const ReasonCodeSchema = z.enum(reasonCodes);

const CheckSchema = z.object({
  label: z.string(),
  result: z.enum(["pass", "warn", "fail"]),
  detail: z.string(),
  source: z.string(),
});

const OverrideSchema = z.object({
  reason_code: ReasonCodeSchema,
  note: z.string(),
  by: z.string(),
  by_id: z.string(),
  at: z.string(),
  previous_decision: DecisionKindSchema,
  previous_payout: z.number(),
});

const DecisionSchema = z.object({
  decision: DecisionKindSchema,
  payout: z.number(),
  calculation: z.object({ lines: z.array(CalculationStepSchema), payout: z.number() }).nullable(),
  section: z.string(),
  reason: z.string(),
  decided_by: z.string(),
  decided_at: z.string(),
  manual_version: z.string(),
  approval_limit: z.number(),
  hold_reason: z.string().nullable(),
  signed_off_by: z.string().nullable(),
  signed_off_at: z.string().nullable(),
  by_screening: z.boolean(),
  checklist: z.array(CheckSchema),
  override: OverrideSchema.nullable(),
});

const StagesSchema = z.object({
  received: z.string(),
  checked: z.string().nullable(),
  assessed: z.string().nullable(),
  decided: z.string().nullable(),
  paid: z.string().nullable(),
});

export const ClaimSchema = z.object({
  claim_id: z.string(),
  customer_name: z.string(),
  claim_type: z.string(),
  summary: z.string(),
  amount_claimed: z.number(),
  submitted_on: z.string(),
  status: StatusSchema,
  incident_date: z.string(),
  incident_location: z.string(),
  story: z.string(),
  items: z.array(ItemSchema),
  documents: z.array(z.object({ name: z.string(), type: z.string(), content: z.string() })),
  policy: PolicySchema,
  approval_limit: z.number(),
  decision: DecisionSchema.nullable(),
  payment: z
    .object({
      amount: z.number(),
      paid_at: z.string(),
      signed_off_by: z.string().nullable(),
      paid_to: z.string().nullable(),
    })
    .nullable(),
  sent_back_decisions: z.array(
    z.object({
      decision: DecisionSchema,
      note: z.string(),
      sent_back_by: z.string(),
      sent_back_at: z.string(),
    }),
  ),
  receipts: z.array(ReceiptSchema),
  stages: StagesSchema,
  review_requested_at: z.string().nullable(),
  review_note: z.string().nullable(),
  requests: z.array(
    z.object({
      request_id: z.number(),
      text: z.string(),
      asked_by: z.string(),
      asked_at: z.string(),
      fulfilled_at: z.string().nullable(),
      files: z.number(),
    }),
  ),
});

export const RiskSchema = z.object({
  shared_receipts: z.array(
    z.object({ receipt: z.number(), claim_id: z.string(), match: z.string() }),
  ),
  earlier_claims: z.number(),
  earlier_paid: z.number(),
  amount_claimed: z.number(),
  typical_amount: z.number().nullable(),
  high_amount: z.boolean(),
});

export type Risk = z.infer<typeof RiskSchema>;

export const StepSchema = z.object({
  step_id: z.number(),
  kind: StepKindSchema,
  content: z.string(),
  sources: z.array(SourceSchema),
  created_at: z.string(),
});

export const PayoutSwitchSchema = z.object({
  paused: z.boolean(),
  changed_by: z.string().nullable(),
  changed_at: z.string().nullable(),
  reason: z.string().nullable(),
});

export const SignInSchema = z.object({ id_token: z.string(), expires_in: z.number() });

export const TraceSchema = z.object({
  steps: z.array(StepSchema),
  model_calls: z.array(
    z.object({
      model: z.string(),
      input_tokens: z.number(),
      output_tokens: z.number(),
      cost: z.number(),
      latency_ms: z.number().nullable(),
      created_at: z.string(),
    }),
  ),
  total_cost: z.number(),
  total_tokens: z.number(),
});

export type Status = z.infer<typeof StatusSchema>;
export type DecisionKind = z.infer<typeof DecisionKindSchema>;
export type StepKind = z.infer<typeof StepKindSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type Handler = z.infer<typeof HandlerSchema>;
export type ClaimSummary = z.infer<typeof ClaimSummarySchema>;
export type Policy = z.infer<typeof PolicySchema>;
export type CalculationStep = z.infer<typeof CalculationStepSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type SentBackDecision = Claim["sent_back_decisions"][number];
export type Payment = NonNullable<Claim["payment"]>;
export type Step = z.infer<typeof StepSchema>;
export type Receipt = z.infer<typeof ReceiptSchema>;
export type Item = z.infer<typeof ItemSchema>;
export type Check = z.infer<typeof CheckSchema>;
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;
export type Stages = z.infer<typeof StagesSchema>;
export type Trace = z.infer<typeof TraceSchema>;
export type PayoutSwitch = z.infer<typeof PayoutSwitchSchema>;

export interface OverrideRequest {
  decision: DecisionKind;
  payout: number;
  reason_code: ReasonCode;
  note: string;
}

export type TestAccount = "senior" | "handler";

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
  testSignIn: (account: TestAccount) => Promise<string>;
  me: () => Promise<Handler>;
  listClaims: () => Promise<ClaimSummary[]>;
  getClaim: (claimId: string, signal?: AbortSignal) => Promise<Claim>;
  listSteps: (claimId: string, signal?: AbortSignal) => Promise<Step[]>;
  workClaim: (claimId: string) => Promise<Claim>;
  signOff: (claimId: string) => Promise<Claim>;
  sendBack: (claimId: string, note: string) => Promise<Claim>;
  askCustomer: (claimId: string, text: string) => Promise<Claim>;
  getRisk: (claimId: string) => Promise<Risk>;
  receipt: (claimId: string, receiptId: string) => Promise<Blob>;
  getTrace: (claimId: string, signal?: AbortSignal) => Promise<Trace>;
  override: (claimId: string, request: OverrideRequest) => Promise<Claim>;
  getPayouts: () => Promise<PayoutSwitch>;
  setPayouts: (paused: boolean, reason: string) => Promise<PayoutSwitch>;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const FALLBACK_ERROR = "Something went wrong talking to the server. Please try again.";
const SHAPE_ERROR = "The server sent something the dashboard didn't expect. Please try again.";
// The status given to a response that arrived but had the wrong shape.
export const BAD_RESPONSE = 0;

const ValidationDetail = z.array(z.object({ msg: z.string() }));

/** The api's error as a plain message: its detail, or FastAPI's validation messages joined. */
async function errorFrom(response: Response): Promise<ApiError> {
  try {
    const body: unknown = await response.json();
    const detail = z.object({ detail: z.unknown() }).safeParse(body);
    if (detail.success) {
      if (typeof detail.data.detail === "string") {
        return new ApiError(response.status, detail.data.detail);
      }
      const problems = ValidationDetail.safeParse(detail.data.detail);
      if (problems.success && problems.data.length > 0) {
        return new ApiError(response.status, problems.data.map((p) => p.msg).join(". "));
      }
    }
  } catch {
    // Not JSON: fall back to the plain message below.
  }
  return new ApiError(response.status, FALLBACK_ERROR);
}

export function createApi(fetchFn: Fetch, getToken: () => string | null): Api {
  async function send(
    method: "GET" | "POST" | "PUT",
    path: string,
    options: { body?: unknown; form?: FormData; signal?: AbortSignal } = {},
    accept = "application/json",
  ): Promise<Response> {
    const headers: Record<string, string> = { Accept: accept };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    // A form sets its own multipart content type, with the boundary.
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const body =
      options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    const response = await fetchFn(`/api/staff${path}`, {
      method,
      headers,
      body,
      signal: options.signal,
    });
    if (!response.ok) throw await errorFrom(response);
    return response;
  }

  async function call<T>(
    schema: z.ZodType<T>,
    method: "GET" | "POST" | "PUT",
    path: string,
    options: { body?: unknown; form?: FormData; signal?: AbortSignal } = {},
  ): Promise<T> {
    const response = await send(method, path, options);
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) throw new ApiError(BAD_RESPONSE, SHAPE_ERROR);
    return parsed.data;
  }

  const claimPath = (claimId: string) => `/claims/${encodeURIComponent(claimId)}`;

  return {
    signIn: async (email, password) => {
      const answer = await call(SignInSchema, "POST", "/dev/sign-in", {
        body: { email, password },
      });
      return answer.id_token;
    },
    testSignIn: async (account) => {
      const answer = await call(SignInSchema, "POST", "/dev/test-sign-in", { body: { account } });
      return answer.id_token;
    },
    me: () => call(HandlerSchema, "GET", "/me"),
    listClaims: () => call(z.array(ClaimSummarySchema), "GET", "/claims"),
    getClaim: (claimId, signal) => call(ClaimSchema, "GET", claimPath(claimId), { signal }),
    listSteps: (claimId, signal) =>
      call(z.array(StepSchema), "GET", `${claimPath(claimId)}/steps`, { signal }),
    workClaim: (claimId) => call(ClaimSchema, "POST", `${claimPath(claimId)}/work`),
    signOff: (claimId) => call(ClaimSchema, "POST", `${claimPath(claimId)}/sign-off`),
    sendBack: (claimId, note) =>
      call(ClaimSchema, "POST", `${claimPath(claimId)}/send-back`, { body: { note } }),
    getRisk: (claimId) => call(RiskSchema, "GET", `${claimPath(claimId)}/risk`),
    askCustomer: (claimId, text) =>
      call(ClaimSchema, "POST", `${claimPath(claimId)}/requests`, { body: { text } }),
    receipt: async (claimId, receiptId) => {
      const path = `${claimPath(claimId)}/receipts/${encodeURIComponent(receiptId)}`;
      const response = await send("GET", path, {}, "*/*");
      return response.blob();
    },
    getTrace: (claimId, signal) =>
      call(TraceSchema, "GET", `${claimPath(claimId)}/trace`, { signal }),
    override: (claimId, request) =>
      call(ClaimSchema, "POST", `${claimPath(claimId)}/override`, { body: request }),
    getPayouts: () => call(PayoutSwitchSchema, "GET", "/payouts"),
    setPayouts: (paused, reason) =>
      call(PayoutSwitchSchema, "PUT", "/payouts", { body: { paused, reason } }),
  };
}
