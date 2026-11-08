/*
 * The one module that talks to the api. Every response is checked against a schema here, at
 * the boundary, so nothing the rest of the portal renders can have the wrong shape; the types
 * come from the schemas. The portal talks only to the api's customer routes, under
 * /api/customer; src/fixtures/ holds real responses from them that the tests parse.
 */
import { z } from "zod";

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

export const SignInSchema = z.object({ id_token: z.string(), expires_in: z.number() });

export type DecisionKind = z.infer<typeof DecisionKindSchema>;
export type Customer = z.infer<typeof CustomerSchema>;
export type CustomerStatus = z.infer<typeof CustomerStatusSchema>;
export type Policy = z.infer<typeof PolicySchema>;
export type Receipt = z.infer<typeof ReceiptSchema>;
export type Item = z.infer<typeof ItemSchema>;
export type CustomerClaimSummary = z.infer<typeof CustomerClaimSummarySchema>;
export type CustomerClaim = z.infer<typeof CustomerClaimSchema>;

export interface NewClaim {
  policy_id: string;
  claim_type: string;
  incident_date: string;
  incident_location: string;
  summary: string;
  story: string;
  items: Item[];
}

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

export function createApi(fetchFn: Fetch, getToken: () => string | null): Api {
  async function call<T>(
    schema: z.ZodType<T>,
    method: "GET" | "POST",
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
  };
}
