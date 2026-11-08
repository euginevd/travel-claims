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
    .object({ amount: z.number(), paid_at: z.string(), signed_off_by: z.string().nullable() })
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
});

// --- The customers' portal ---

export const customerStatuses = [
  "received",
  "assessing",
  "reviewing",
  "approved",
  "paid",
  "declined",
  "with_a_handler",
] as const;
const CustomerStatusSchema = z.enum(customerStatuses);

export const CustomerSchema = z.object({
  customer_id: z.string(),
  name: z.string(),
  email: z.string(),
});

export const MyPolicySchema = PolicySchema;

export const CustomerClaimSummarySchema = z.object({
  claim_id: z.string(),
  policy_id: z.string(),
  claim_type: z.string(),
  summary: z.string(),
  amount_claimed: z.number(),
  submitted_on: z.string(),
  status: CustomerStatusSchema,
  status_text: z.string(),
});

export const CustomerClaimSchema = CustomerClaimSummarySchema.extend({
  incident_date: z.string(),
  incident_location: z.string(),
  story: z.string(),
  items: z.array(ItemSchema),
  outcome: DecisionKindSchema.nullable(),
  reason: z.string().nullable(),
  paid: z.number().nullable(),
  paid_at: z.string().nullable(),
  receipts: z.array(ReceiptSchema),
  can_add_receipts: z.boolean(),
});

export const StepSchema = z.object({
  step_id: z.number(),
  kind: StepKindSchema,
  content: z.string(),
  sources: z.array(SourceSchema),
  created_at: z.string(),
});

export const SignInSchema = z.object({ id_token: z.string(), expires_in: z.number() });

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
export type Customer = z.infer<typeof CustomerSchema>;
export type CustomerStatus = z.infer<typeof CustomerStatusSchema>;
export type CustomerClaimSummary = z.infer<typeof CustomerClaimSummarySchema>;
export type CustomerClaim = z.infer<typeof CustomerClaimSchema>;
export type Role = "customer" | "handler";

export interface NewClaim {
  policy_id: string;
  claim_type: string;
  incident_date: string;
  incident_location: string;
  summary: string;
  story: string;
  items: Item[];
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
  signIn: (email: string, password: string, role?: Role) => Promise<string>;
  me: () => Promise<Handler>;
  listClaims: () => Promise<ClaimSummary[]>;
  getClaim: (claimId: string, signal?: AbortSignal) => Promise<Claim>;
  listSteps: (claimId: string, signal?: AbortSignal) => Promise<Step[]>;
  workClaim: (claimId: string) => Promise<Claim>;
  signOff: (claimId: string) => Promise<Claim>;
  sendBack: (claimId: string, note: string) => Promise<Claim>;
  receipt: (claimId: string, receiptId: string) => Promise<Blob>;
  myProfile: () => Promise<Customer>;
  myPolicies: () => Promise<Policy[]>;
  myClaims: () => Promise<CustomerClaimSummary[]>;
  myClaim: (claimId: string) => Promise<CustomerClaim>;
  makeClaim: (claim: NewClaim) => Promise<CustomerClaim>;
  addReceipts: (claimId: string, files: File[]) => Promise<CustomerClaim>;
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
    method: "GET" | "POST",
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
    const response = await fetchFn(`/api${path}`, {
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
    method: "GET" | "POST",
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
    signIn: async (email, password, role = "handler") => {
      const answer = await call(SignInSchema, "POST", "/dev/sign-in", {
        body: { email, password, role },
      });
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
    receipt: async (claimId, receiptId) => {
      const path = `${claimPath(claimId)}/receipts/${encodeURIComponent(receiptId)}`;
      const response = await send("GET", path, {}, "*/*");
      return response.blob();
    },
    myProfile: () => call(CustomerSchema, "GET", "/my/profile"),
    myPolicies: () => call(z.array(MyPolicySchema), "GET", "/my/policies"),
    myClaims: () => call(z.array(CustomerClaimSummarySchema), "GET", "/my/claims"),
    myClaim: (claimId) => call(CustomerClaimSchema, "GET", `/my${claimPath(claimId)}`),
    makeClaim: (claim) => call(CustomerClaimSchema, "POST", "/my/claims", { body: claim }),
    addReceipts: (claimId, files) => {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      return call(CustomerClaimSchema, "POST", `/my${claimPath(claimId)}/receipts`, { form });
    },
  };
}
