/*
 * The one module that talks to the Copilot service at /api/copilot, with the handler's own
 * sign-in. Every response is checked against a schema here.
 */
import { z } from "zod";
import { ApiError, BAD_RESPONSE } from "./api";

const EntrySchema = z.object({
  role: z.enum(["user", "assistant"]).optional(),
  text: z.string().optional(),
  kind: z.enum(["step", "action", "error", "confirm"]).optional(),
  title: z.string().optional(),
  detail: z.string().optional(),
});

// What waits on the handler: a sign-off (the default, as older conversations saved it), a
// dispatch or a send-back, each with the facts its card shows.
const PendingSchema = z.object({
  kind: z.literal("confirm"),
  action: z.enum(["sign_off", "dispatch", "send_back"]).default("sign_off"),
  title: z.string(),
  detail: z.string(),
  claim_id: z.string().optional(),
  customer: z.string().optional(),
  amount: z.number().optional(),
  note: z.string().optional(),
  agents: z.number().optional(),
  waiting: z.number().optional(),
});

export const ConversationSchema = z.object({
  conversation_id: z.string(),
  title: z.string(),
  created_at: z.string(),
  transcript: z.array(EntrySchema),
  pending: PendingSchema.nullable(),
  // The last turn's tool steps, model calls, seconds of work and cost in US dollars.
  steps: z.number().default(0),
  model_calls: z.number().default(0),
  seconds: z.number().default(0),
  cost_usd: z.number().default(0),
});

const SummarySchema = z.object({
  conversation_id: z.string(),
  title: z.string(),
  created_at: z.string(),
});

export type Entry = z.infer<typeof EntrySchema>;
export type Pending = z.infer<typeof PendingSchema>;
export type Answer = "sign_off" | "confirm" | "cancel";
export type Conversation = z.infer<typeof ConversationSchema>;
export type ConversationSummary = z.infer<typeof SummarySchema>;

export interface CopilotApi {
  list: () => Promise<ConversationSummary[]>;
  start: () => Promise<Conversation>;
  open: (conversationId: string) => Promise<Conversation>;
  send: (conversationId: string, text: string) => Promise<Conversation>;
  confirm: (conversationId: string, answer: Answer) => Promise<Conversation>;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export function createCopilot(fetchFn: Fetch, getToken: () => string | null): CopilotApi {
  async function call<T>(schema: z.ZodType<T>, method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetchFn(`/api/copilot${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      let message = "The Copilot couldn't answer. Please try again.";
      try {
        const detail = z.object({ detail: z.string() }).safeParse(await response.json());
        if (detail.success) message = detail.data.detail;
      } catch {
        // Not JSON: keep the plain message.
      }
      throw new ApiError(response.status, message);
    }
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) throw new ApiError(BAD_RESPONSE, "The Copilot sent something unexpected.");
    return parsed.data;
  }

  const one = (id: string) => `/conversations/${encodeURIComponent(id)}`;
  return {
    list: () => call(z.array(SummarySchema), "GET", "/conversations"),
    start: () => call(ConversationSchema, "POST", "/conversations"),
    open: (id) => call(ConversationSchema, "GET", one(id)),
    send: (id, text) => call(ConversationSchema, "POST", `${one(id)}/messages`, { text }),
    confirm: (id, answer) => call(ConversationSchema, "POST", `${one(id)}/confirm`, { answer }),
  };
}
