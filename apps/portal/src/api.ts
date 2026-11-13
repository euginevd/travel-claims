/*
 * The one module that talks to the api. Every response is checked against a schema here, at
 * the boundary, so nothing the rest of the portal renders can have the wrong shape; the types
 * come from the schemas. The portal talks only to the api's customer routes, under
 * /api/customer; src/fixtures/ holds real responses from them that the tests parse.
 */
import { z } from "zod";
import { type CognitoConfig, cognitoConfig, cognitoSignIn } from "@undercover/web-core/cognito";

const DecisionKindSchema = z.enum(["approve", "decline", "refer"]);

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

export const PolicySchema = z.object({
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

export const ReceiptSchema = z.object({
  receipt_id: z.string(),
  media_type: z.string(),
  size: z.number(),
  uploaded_at: z.string(),
});

export const CustomerRequestSchema = z.object({
  request_id: z.number(),
  text: z.string(),
  asked_by: z.string(),
  asked_at: z.string(),
  fulfilled_at: z.string().nullable(),
  files: z.number(),
});

const ItemSchema = z.object({ description: z.string(), category: z.string(), amount: z.number() });

export const CustomerClaimSummarySchema = z.object({
  claim_id: z.string(),
  policy_id: z.string(),
  claim_type: z.string(),
  summary: z.string(),
  amount_claimed: z.number(),
  submitted_on: z.string(),
  status: CustomerStatusSchema,
  status_text: z.string(),
  open_requests: z.number(),
});

const LetterSchema = z.object({
  subject: z.string(),
  body: z.string(),
  drafted_by_ai: z.boolean(),
  sent_by: z.string(),
  sent_at: z.string(),
});

export const CustomerClaimSchema = CustomerClaimSummarySchema.extend({
  letter: LetterSchema.nullable(),
  incident_date: z.string(),
  incident_location: z.string(),
  story: z.string(),
  items: z.array(ItemSchema),
  outcome: DecisionKindSchema.nullable(),
  reason: z.string().nullable(),
  paid: z.number().nullable(),
  paid_at: z.string().nullable(),
  paid_to: z.string().nullable(),
  receipts: z.array(ReceiptSchema),
  requests: z.array(CustomerRequestSchema),
  can_add_receipts: z.boolean(),
  review_requested: z.boolean(),
  can_request_review: z.boolean(),
});

export const DraftSchema = z.object({
  claim_type: z.string().nullable(),
  summary: z.string(),
  story: z.string(),
  incident_date: z.string(),
  incident_location: z.string(),
  items: z.array(
    z.object({
      description: z.string(),
      category: z.string(),
      amount: z.number(),
      source: z.string(),
    }),
  ),
  missing_questions: z.array(z.string()),
  low_confidence_fields: z.array(z.string()),
});

export const NoticeSchema = z.object({
  notice_id: z.number(),
  claim_id: z.string().nullable(),
  channel: z.enum(["email", "sms"]),
  subject: z.string(),
  body: z.string(),
  sent_at: z.string(),
});

export const PayIdSchema = z.object({ payid: z.string().nullable() });

export const SettingsSchema = z.object({
  email: z.string(),
  mobile: z.string(),
  text_updates: z.boolean(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DelayOfferSchema = z.object({
  flight_id: z.string(),
  policy_id: z.string(),
  flight: z.string(),
  route: z.string(),
  date: z.string(),
  delay_minutes: z.number(),
  waiting_hours: z.number(),
  estimate: z.number(),
});

export const ClaimDraftSchema = z.object({
  policy_id: z.string(),
  case: z.string(),
  text: z.string(),
  claim_type: z.string(),
  summary: z.string(),
  story: z.string(),
  incident_date: z.string(),
  incident_location: z.string(),
  items: z.array(z.object({ description: z.string(), category: z.string(), amount: z.string() })),
  step: z.enum(["what", "receipts", "check"]),
});

export const CoverSchema = z.object({
  policy_id: z.string(),
  destination: z.string(),
  departs_on: z.string(),
  returns_on: z.string(),
  plan: z.object({
    plan: z.string(),
    name: z.string(),
    trip_cancellation_max: z.number(),
    trip_delay_waiting_hours: z.number(),
    trip_delay_max: z.number(),
    baggage_delay_waiting_hours: z.number(),
    baggage_delay_max: z.number(),
    baggage_max: z.number(),
    per_item_limit: z.number(),
    passport_max: z.number(),
    emergency_medical_max: z.number(),
    deductible: z.number(),
  }),
  add_ons: z.array(z.string()),
});

export type Cover = z.infer<typeof CoverSchema>;

export const answerActions = [
  "",
  "start_claim",
  "show_claim",
  "show_claims",
  "show_policy",
  "settings",
  "talk_to_person",
] as const;

export const AnswerSchema = z.object({
  answer: z.string(),
  sources: z.array(z.string()),
  // What the portal offers next: Wattle names it, the customer's tap does it.
  action: z.enum(answerActions).catch("").default(""),
  claim_type: z.string().default(""),
  claim_id: z.string().default(""),
  replies: z.array(z.string()).max(3).catch([]).default([]),
  screened: z.boolean(),
  // Automated Reasoning found it consistent with the policy wording's rules (on AWS).
  verified: z.boolean().default(false),
  // The answer laid out: a headline, short points citing the sources, one likely next question.
  headline: z.string().default(""),
  points: z.array(z.object({ text: z.string(), source: z.number().int().default(0) })).default([]),
  next: z.string().default(""),
});

export type Answer = z.infer<typeof AnswerSchema>;
export interface AskTurn {
  role: "user" | "assistant";
  text: string;
}

export const SavedDraftSchema = z.object({ draft: ClaimDraftSchema, updated_at: z.string() });

export const SignInSchema = z.object({ id_token: z.string(), expires_in: z.number() });

export type DecisionKind = z.infer<typeof DecisionKindSchema>;
export type Customer = z.infer<typeof CustomerSchema>;
export type CustomerStatus = z.infer<typeof CustomerStatusSchema>;
export type Policy = z.infer<typeof PolicySchema>;
export type Receipt = z.infer<typeof ReceiptSchema>;
export type Item = z.infer<typeof ItemSchema>;
export type CustomerClaimSummary = z.infer<typeof CustomerClaimSummarySchema>;
export type CustomerClaim = z.infer<typeof CustomerClaimSchema>;
export type Draft = z.infer<typeof DraftSchema>;
export type CustomerRequest = z.infer<typeof CustomerRequestSchema>;
export type Notice = z.infer<typeof NoticeSchema>;
export type DelayOffer = z.infer<typeof DelayOfferSchema>;
export type ClaimDraft = z.infer<typeof ClaimDraftSchema>;
export type SavedDraft = z.infer<typeof SavedDraftSchema>;

export const caseChips = [
  "lost_bag",
  "delayed_bag",
  "flight_delay",
  "trip_cancelled",
  "medical",
  "stolen",
  "passport",
  "other",
] as const;
export type CaseChip = (typeof caseChips)[number];

export interface NewClaim {
  policy_id: string;
  claim_type: string;
  incident_date: string;
  incident_location: string;
  summary: string;
  story: string;
  items: Item[];
}

export const FeedbackSchema = z.object({
  feedback_id: z.number(),
  subject: z.enum(["answer", "decision"]),
  claim_id: z.string().nullable(),
  helpful: z.boolean(),
  comment: z.string().nullable(),
});
export type Feedback = z.infer<typeof FeedbackSchema>;
/** A vote on one of Wattle's answers or on a decision's explanation. */
export interface Vote {
  subject: "answer" | "decision";
  claim_id?: string;
  helpful: boolean;
  comment?: string;
  question?: string;
  feedback_id?: number;
}
// The longest comment or question the api keeps with a vote.
export const FEEDBACK_WORDS = 300;

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
  myProfile: () => Promise<Customer>;
  myPolicies: () => Promise<Policy[]>;
  myClaims: () => Promise<CustomerClaimSummary[]>;
  myClaim: (claimId: string) => Promise<CustomerClaim>;
  makeClaim: (claim: NewClaim) => Promise<CustomerClaim>;
  addReceipts: (claimId: string, files: File[]) => Promise<CustomerClaim>;
  draft: (policyId: string, text: string, chip: CaseChip | "", files: File[]) => Promise<Draft>;
  requestReview: (claimId: string, note: string) => Promise<CustomerClaim>;
  answerRequest: (claimId: string, requestId: number, files: File[]) => Promise<CustomerClaim>;
  myNotices: () => Promise<Notice[]>;
  myPayId: () => Promise<string | null>;
  setPayId: (payid: string) => Promise<string | null>;
  mySettings: () => Promise<Settings>;
  setSettings: (settings: { mobile: string; text_updates: boolean }) => Promise<Settings>;
  myDelays: () => Promise<DelayOffer[]>;
  myCover: () => Promise<Cover[]>;
  ask: (question: string, history: AskTurn[], about?: string) => Promise<Answer>;
  claimDelay: (flightId: string) => Promise<CustomerClaim>;
  myDraft: () => Promise<SavedDraft | null>;
  saveDraft: (draft: ClaimDraft) => Promise<SavedDraft>;
  discardDraft: () => Promise<void>;
  testSignIn: () => Promise<string>;
  giveFeedback: (vote: Vote) => Promise<Feedback>;
  myDecisionFeedback: (claimId: string) => Promise<Feedback | null>;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const FALLBACK_ERROR = "Something went wrong talking to the server. Please try again.";
const SHAPE_ERROR = "The server sent something we didn't expect. Please try again.";
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

export function createApi(
  fetchFn: Fetch,
  getToken: () => string | null,
  cognito: CognitoConfig | null = cognitoConfig(import.meta.env),
): Api {
  async function call<T>(
    schema: z.ZodType<T>,
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    options: { body?: unknown; form?: FormData } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    // A form sets its own multipart content type, with the boundary.
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const body =
      options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    const response = await fetchFn(`/api/customer${path}`, { method, headers, body });
    if (!response.ok) throw await errorFrom(response);
    if (response.status === 204) return schema.parse(undefined);
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) throw new ApiError(BAD_RESPONSE, SHAPE_ERROR);
    return parsed.data;
  }

  const claimPath = (claimId: string) => `/claims/${encodeURIComponent(claimId)}`;

  return {
    signIn: async (email, password) => {
      if (cognito) {
        const result = await cognitoSignIn(fetchFn, cognito, email, password);
        if ("token" in result) return result.token;
        // Customers' pool asks for no second step: one it does ask for can't be answered here.
        if ("challenge" in result) {
          throw new ApiError(403, "This account needs a sign-in step the portal doesn't offer.");
        }
        throw new ApiError(result.status, result.message);
      }
      const answer = await call(SignInSchema, "POST", "/dev/sign-in", {
        body: { email, password },
      });
      return answer.id_token;
    },
    testSignIn: async () => {
      const answer = await call(SignInSchema, "POST", "/dev/test-sign-in", {
        body: { account: "customer" },
      });
      return answer.id_token;
    },
    myProfile: () => call(CustomerSchema, "GET", "/profile"),
    myPolicies: () => call(z.array(PolicySchema), "GET", "/policies"),
    myClaims: () => call(z.array(CustomerClaimSummarySchema), "GET", "/claims"),
    myClaim: (claimId) => call(CustomerClaimSchema, "GET", claimPath(claimId)),
    makeClaim: (claim) => call(CustomerClaimSchema, "POST", "/claims", { body: claim }),
    addReceipts: (claimId, files) => {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      return call(CustomerClaimSchema, "POST", `${claimPath(claimId)}/receipts`, { form });
    },
    draft: (policyId, text, chip, files) => {
      const form = new FormData();
      form.append("policy_id", policyId);
      form.append("text", text);
      form.append("case", chip);
      for (const file of files) form.append("files", file);
      return call(DraftSchema, "POST", "/drafts", { form });
    },
    requestReview: (claimId, note) =>
      call(CustomerClaimSchema, "POST", `${claimPath(claimId)}/review-request`, {
        body: { note },
      }),
    answerRequest: (claimId, requestId, files) => {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      return call(
        CustomerClaimSchema,
        "POST",
        `${claimPath(claimId)}/requests/${String(requestId)}/files`,
        { form },
      );
    },
    myNotices: () => call(z.array(NoticeSchema), "GET", "/notices"),
    myPayId: async () => (await call(PayIdSchema, "GET", "/payid")).payid,
    setPayId: async (payid) =>
      (await call(PayIdSchema, "PUT", "/payid", { body: { payid } })).payid,
    mySettings: () => call(SettingsSchema, "GET", "/settings"),
    setSettings: (settings) => call(SettingsSchema, "PUT", "/settings", { body: settings }),
    myDelays: () => call(z.array(DelayOfferSchema), "GET", "/delays"),
    myCover: () => call(z.array(CoverSchema), "GET", "/cover"),
    ask: (question, history, about = "") =>
      call(AnswerSchema, "POST", "/ask", {
        body: { question, history: history.slice(-8), about },
      }),
    claimDelay: (flightId) =>
      call(CustomerClaimSchema, "POST", `/delays/${encodeURIComponent(flightId)}/claim`),
    myDraft: () => call(SavedDraftSchema.nullable(), "GET", "/draft"),
    saveDraft: (draft) => call(SavedDraftSchema, "PUT", "/draft", { body: draft }),
    discardDraft: () => call(z.undefined(), "DELETE", "/draft"),
    giveFeedback: (vote) => call(FeedbackSchema, "POST", "/feedback", { body: vote }),
    myDecisionFeedback: (claimId) =>
      call(FeedbackSchema.nullable(), "GET", `${claimPath(claimId)}/feedback`),
  };
}
