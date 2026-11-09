/*
 * The one module that talks to the api's engineering routes, under /api/engineering. Every
 * response is checked against a schema here, at the boundary; the types come from the schemas.
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

export const EngineerSchema = z.object({
  engineer_id: z.string(),
  name: z.string(),
  role: z.string(),
  email: z.string(),
});
const RedTeamResultSchema = z.object({
  attack_id: z.string(),
  name: z.string(),
  technique: z.string(),
  owasp: z.string(),
  claim_id: z.string().nullable(),
  outcome: z.string(),
  decided_by: z.string(),
  paid: z.number(),
  passed: z.boolean(),
  note: z.string(),
});

export const RedTeamReportSchema = z.object({
  run_at: z.string(),
  run_by: z.string(),
  results: z.array(RedTeamResultSchema),
});

export const RedTeamStatusSchema = z.object({
  running: z.boolean(),
  started_at: z.string().nullable(),
  started_by: z.string().nullable(),
  report: RedTeamReportSchema.nullable(),
});

export const SignInSchema = z.object({ id_token: z.string(), expires_in: z.number() });

export const NOTE_LIMIT = 1000;

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const ScoresSchema = z.object({
  claims: z.number(),
  decided: z.number(),
  accuracy: z.number(),
  payout_accuracy: z.number(),
  straight_through: z.number(),
  cost_per_claim: z.number(),
  seconds_per_claim: z.number(),
  total_cost: z.number(),
});

export const RunSchema = z.object({
  run_id: z.number(),
  label_set: z.enum(["evaluation", "held_out"]),
  size: z.enum(["tiny", "whole"]),
  concurrency: z.number(),
  config_version: z.number(),
  round_id: z.number().nullable(),
  status: z.string(),
  started_by: z.string(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  scores: ScoresSchema.nullable(),
});

export const RunClaimSchema = z.object({
  claim_id: z.string(),
  original_claim_id: z.string(),
  summary: z.string(),
  status: StatusSchema,
  decision: DecisionKindSchema.nullable(),
  payout: z.number().nullable(),
  reason: z.string().nullable(),
  handler_decision: z.string().nullable(),
  handler_payout: z.number().nullable(),
  handler_reason: z.string().nullable(),
  matched: z.boolean(),
  payout_matched: z.boolean(),
  cost: z.number(),
});

export const RunInFullSchema = RunSchema.extend({ claims: z.array(RunClaimSchema) });

export const ConfigurationSchema = z.object({
  version: z.number(),
  instructions: z.string(),
  model: z.string(),
  effort: z.string(),
  reason: z.string(),
  diff: z.string(),
  status: z.string(),
  parent_version: z.number().nullable(),
  proposed_by: z.string(),
  reviewed_by: z.string().nullable(),
  created_at: z.string(),
  current: z.boolean(),
});

export const RoundSchema = z.object({
  round_id: z.number(),
  status: z.string(),
  baseline_version: z.number(),
  candidate_version: z.number().nullable(),
  baseline_eval_run: z.number().nullable(),
  baseline_held_run: z.number().nullable(),
  candidate_held_run: z.number().nullable(),
  proposal: z.record(z.string(), z.unknown()).nullable(),
  review: z.record(z.string(), z.unknown()).nullable(),
  verdict: z.record(z.string(), z.unknown()).nullable(),
  improver_cost: z.number(),
  spend_limit: z.number(),
  spent: z.number(),
  diff: z.string().nullable(),
  started_by: z.string(),
  started_at: z.string(),
});

export type Scores = z.infer<typeof ScoresSchema>;
export type Run = z.infer<typeof RunSchema>;
export type RunClaim = z.infer<typeof RunClaimSchema>;
export type RunInFull = z.infer<typeof RunInFullSchema>;
export type Configuration = z.infer<typeof ConfigurationSchema>;
export type Round = z.infer<typeof RoundSchema>;

export interface StartRunRequest {
  label_set: "evaluation" | "held_out";
  size: "tiny" | "whole";
  concurrency: number;
}

export type Engineer = z.infer<typeof EngineerSchema>;
export type RedTeamResult = z.infer<typeof RedTeamResultSchema>;
export type RedTeamReport = z.infer<typeof RedTeamReportSchema>;
export type RedTeamStatus = z.infer<typeof RedTeamStatusSchema>;

export interface Api {
  signIn: (email: string, password: string) => Promise<string>;
  testSignIn: () => Promise<string>;
  me: () => Promise<Engineer>;
  getRedTeam: () => Promise<RedTeamStatus>;
  startRedTeam: () => Promise<RedTeamStatus>;
  listRuns: () => Promise<Run[]>;
  getRun: (runId: number, signal?: AbortSignal) => Promise<RunInFull>;
  startRun: (request: StartRunRequest) => Promise<Run>;
  resumeRun: (runId: number) => Promise<Run>;
  listConfigurations: () => Promise<Configuration[]>;
  listRounds: () => Promise<Round[]>;
  startRound: () => Promise<Round>;
  reviewRound: (roundId: number, approve: boolean, reason: string) => Promise<Round>;
  stopRound: (roundId: number) => Promise<Round>;
}
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const FALLBACK_ERROR = "Something went wrong talking to the server. Please try again.";
const SHAPE_ERROR = "The server sent something the console didn't expect. Please try again.";
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
    options: { body?: unknown; signal?: AbortSignal } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const response = await fetchFn(`/api/engineering${path}`, {
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
    options: { body?: unknown; signal?: AbortSignal } = {},
  ): Promise<T> {
    const response = await send(method, path, options);
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) throw new ApiError(BAD_RESPONSE, SHAPE_ERROR);
    return parsed.data;
  }

  return {
    signIn: async (email, password) => {
      const answer = await call(SignInSchema, "POST", "/dev/sign-in", {
        body: { email, password },
      });
      return answer.id_token;
    },
    testSignIn: async () => {
      const answer = await call(SignInSchema, "POST", "/dev/test-sign-in", {
        body: { account: "engineer" },
      });
      return answer.id_token;
    },
    me: () => call(EngineerSchema, "GET", "/me"),
    getRedTeam: () => call(RedTeamStatusSchema, "GET", "/redteam"),
    startRedTeam: () => call(RedTeamStatusSchema, "POST", "/redteam/runs"),
    listRuns: () => call(z.array(RunSchema), "GET", "/runs"),
    getRun: (runId, signal) => call(RunInFullSchema, "GET", `/runs/${String(runId)}`, { signal }),
    startRun: (request) => call(RunSchema, "POST", "/runs", { body: request }),
    resumeRun: (runId) => call(RunSchema, "POST", `/runs/${String(runId)}/resume`),
    listConfigurations: () => call(z.array(ConfigurationSchema), "GET", "/configuration"),
    listRounds: () => call(z.array(RoundSchema), "GET", "/rounds"),
    startRound: () => call(RoundSchema, "POST", "/rounds"),
    reviewRound: (roundId, approve, reason) =>
      call(RoundSchema, "POST", `/rounds/${String(roundId)}/review`, {
        body: { approve, reason },
      }),
    stopRound: (roundId) => call(RoundSchema, "POST", `/rounds/${String(roundId)}/stop`),
  };
}
