/*
 * The one module that talks to the api's engineering routes, under /api/engineering. Every
 * response is checked against a schema here, at the boundary; the types come from the schemas.
 */
import { z } from "zod";
import { type CognitoConfig, cognitoConfig, cognitoSignIn } from "./cognito";

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
  config_version: z.number().nullable().default(null),
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
  grade: z.number().nullable().default(null),
  graded: z.number().default(0),
  judge_cost: z.number().default(0),
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
  grading: z.boolean().default(false),
});

export const RunClaimSchema = z.object({
  claim_id: z.string(),
  original_claim_id: z.string(),
  claim_type: z.string().optional(),
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
  judged: z.boolean().default(false),
  grade: z.number().int().min(0).max(3).nullable().default(null),
  same_grounds: z.boolean().nullable().default(null),
  same_section: z.boolean().nullable().default(null),
  grade_note: z.string().nullable().default(null),
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

export const TraceSchema = z.object({
  steps: z.array(
    z.object({
      step_id: z.number(),
      kind: z.string(),
      content: z.string(),
      created_at: z.string(),
    }),
  ),
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
  // What the engineers read it against: the claim, its outcome, the agent version that worked it
  // and what a live claim costs on average.
  summary: z.string(),
  status: StatusSchema,
  outcome: z
    .object({
      decision: DecisionKindSchema,
      payout: z.number(),
      section: z.string(),
      reason: z.string(),
      decided_by: z.string(),
      decided_at: z.string(),
    })
    .nullable(),
  config_version: z.number().nullable(),
  average_cost: z.number().nullable(),
});

export type Trace = z.infer<typeof TraceSchema>;

export const ThreatCoverageSchema = z.object({
  redteam_run_at: z.string().nullable(),
  threats: z.array(
    z.object({
      owasp: z.string(),
      risk: z.string(),
      atlas: z.string(),
      control: z.string(),
      attacks: z.array(z.object({ attack_id: z.string(), name: z.string(), passed: z.boolean() })),
      last_fired: z.string().nullable(),
      fired: z.number(),
    }),
  ),
  agents: z.array(
    z.object({
      agent: z.string(),
      model: z.string(),
      tools: z.string(),
      sources: z.string(),
      worst_case: z.string(),
      stopped_by: z.string(),
    }),
  ),
  payouts: z.object({
    paused: z.boolean(),
    changed_by: z.string().nullable(),
    changed_at: z.string().nullable(),
    reason: z.string().nullable(),
  }),
});

export const SuccessCriteriaSchema = z.object({
  met: z.boolean(),
  criteria: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      unit: z.enum(["share", "count"]),
      target: z.number(),
      actual: z.number().nullable(),
      // Null when there is nothing yet to measure.
      met: z.boolean().nullable(),
      detail: z.string(),
    }),
  ),
});

// The handlers' settings, read-only here: the console only needs the values.
export const SettingsSchema = z.object({
  values: z.object({
    approval_limit: z.number(),
    round_spend_limit: z.number(),
    accuracy_objective: z.number(),
    straight_through_objective: z.number(),
    agents_at_once: z.number(),
  }),
});

const SeveritySchema = z.enum(["high", "medium", "low"]);
const DetectionKindSchema = z.enum(["guardrail", "hidden_instruction", "refusal", "held"]);
const DetectionCountsSchema = z.object({
  guardrail: z.number(),
  hidden_instruction: z.number(),
  refusal: z.number(),
  held: z.number(),
});

// Where the latest red-team run's attacks were stopped, the gaps and the detections, worked out
// by the api from its own records.
export const PostureSchema = z.object({
  verdict: z.enum(["untested", "failing", "gap", "holding"]),
  redteam: z
    .object({
      run_at: z.string(),
      run_by: z.string(),
      config_version: z.number().nullable(),
      attacks: z.number(),
      held: z.number(),
      paid: z.number(),
    })
    .nullable(),
  layers: z.array(
    z.object({
      key: z.enum(["screening", "agent", "limits", "sign_off"]),
      name: z.string(),
      what: z.string(),
      reached: z.number(),
      stopped: z.number(),
    }),
  ),
  inventory: z.object({
    agents: z.number(),
    models: z.number(),
    risks: z.number(),
    live_version: z.number().nullable(),
  }),
  controls: z.object({
    risks: z.number(),
    with_control: z.number(),
    tested: z.number(),
    llm_tested: z.number(),
    llm_total: z.number(),
    agentic_tested: z.number(),
    agentic_total: z.number(),
  }),
  issues: z.array(
    z.object({
      severity: SeveritySchema,
      title: z.string(),
      detail: z.string(),
      link: z.enum(["redteam", "coverage"]),
    }),
  ),
  detections: DetectionCountsSchema,
  detection_days: z.number(),
  readiness: z.object({
    payouts_paused: z.boolean(),
    live_version: z.number().nullable(),
    tested_version: z.number().nullable(),
    live_version_red_teamed: z.boolean(),
  }),
});

// The controls that fired on live claims, each claim once per control. A summary is the check's
// own reason: untrusted model output that may quote the claim, shown as plain text only.
export const DetectionsSchema = z.object({
  days: z.number(),
  since: z.string(),
  counts: DetectionCountsSchema,
  events: z.array(
    z.object({
      kind: DetectionKindSchema,
      control: z.string(),
      claim_id: z.string(),
      at: z.string(),
      summary: z.string(),
      outcome: z.string(),
    }),
  ),
});

// A live claim worth tracing: the one with the most model calls lately, or none yet.
export const TraceSuggestionSchema = z.object({
  claim_id: z.string().nullable(),
  model_calls: z.number(),
});

export type TraceSuggestion = z.infer<typeof TraceSuggestionSchema>;
export type Posture = z.infer<typeof PostureSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type Detections = z.infer<typeof DetectionsSchema>;
export type DetectionKind = z.infer<typeof DetectionKindSchema>;
export type SuccessCriteria = z.infer<typeof SuccessCriteriaSchema>;
export type Criterion = SuccessCriteria["criteria"][number];
export type Settings = z.infer<typeof SettingsSchema>;
export type ThreatCoverage = z.infer<typeof ThreatCoverageSchema>;
export type Engineer = z.infer<typeof EngineerSchema>;
export type RedTeamResult = z.infer<typeof RedTeamResultSchema>;
export type RedTeamReport = z.infer<typeof RedTeamReportSchema>;
export type RedTeamStatus = z.infer<typeof RedTeamStatusSchema>;

export const AnswerSchema = z.object({
  answer: z.string(),
  sources: z.array(z.string()),
  suggest: z.string(),
  screened: z.boolean(),
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

const HelpfulSchema = z.object({
  count: z.number(),
  helpful: z.number(),
  helpful_share: z.number().nullable(),
});

// How the agent behaves on live claims. The comments and notes are people's own words: shown as
// plain text only.
const SliceSchema = z.object({
  name: z.string(),
  decided: z.number(),
  straight_through_share: z.number().nullable(),
  disagreements: z.number(),
  cost_per_claim: z.number().nullable(),
  first_day: z.string().nullable(),
});
export type Slice = z.infer<typeof SliceSchema>;

export const LiveSchema = z.object({
  days: z.number(),
  since: z.string(),
  until: z.string(),
  version: z.number().nullable().default(null),
  exam: z
    .object({
      version: z.number(),
      claims: z.number(),
      accuracy: z.number(),
      cost_per_claim: z.number(),
      finished_at: z.string().nullable(),
    })
    .nullable()
    .default(null),
  by_version: z.array(SliceSchema).default([]),
  by_claim_type: z.array(SliceSchema).default([]),
  totals: z.object({
    decided: z.number(),
    straight_through: z.number(),
    straight_through_share: z.number().nullable(),
    reviewed: z.number(),
    disagreements: z.number(),
    disagreement_rate: z.number().nullable(),
    referrals: z.number(),
    hidden_instruction_flags: z.number(),
    cost_per_claim: z.number().nullable(),
    seconds_per_claim: z.number().nullable(),
  }),
  series: z.array(
    z.object({
      day: z.string(),
      decided: z.number(),
      straight_through: z.number(),
      reviewed: z.number(),
      disagreements: z.number(),
      referrals: z.number(),
      hidden_instruction_flags: z.number(),
      cost: z.number(),
    }),
  ),
  feedback: z.object({
    answers: HelpfulSchema,
    decisions: HelpfulSchema,
    comments: z.array(
      z.object({
        subject: z.string(),
        claim_id: z.string().nullable(),
        comment: z.string(),
        question: z.string().nullable(),
        created_at: z.string(),
      }),
    ),
  }),
  disagreements: z.array(
    z.object({
      claim_id: z.string(),
      kind: z.enum(["override", "sent_back"]),
      at: z.string(),
      by: z.string(),
      claim_type: z.string(),
      amount_claimed: z.number(),
      agent_decision: z.string(),
      agent_payout: z.number(),
      handler_decision: z.string().nullable(),
      handler_payout: z.number().nullable(),
      reason_code: z.string().nullable(),
      note: z.string(),
      final_decision: z.string().nullable(),
      final_payout: z.number().nullable(),
      in_evaluation_set: z.boolean(),
      can_add: z.boolean(),
    }),
  ),
});
export type Live = z.infer<typeof LiveSchema>;
export type Disagreement = Live["disagreements"][number];
export const LIVE_PERIODS = [7, 14, 30] as const;
export type LivePeriod = (typeof LIVE_PERIODS)[number];

export const AddedSchema = z.object({
  claim_id: z.string(),
  label_set: z.string(),
  status: z.enum(["added", "already_added"]),
  decision: z.string(),
  payout: z.number(),
  added_by: z.string().nullable(),
  added_at: z.string().nullable(),
});
export type Added = z.infer<typeof AddedSchema>;

export interface Api {
  getLive: (days: LivePeriod) => Promise<Live>;
  addToEvaluation: (claimId: string) => Promise<Added>;
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
  restoreVersion: (version: number, reason: string) => Promise<Configuration>;
  getTrace: (claimId: string) => Promise<Trace>;
  getThreats: () => Promise<ThreatCoverage>;
  getPosture: () => Promise<Posture>;
  suggestTrace: () => Promise<TraceSuggestion>;
  getDetections: (days: LivePeriod) => Promise<Detections>;
  getSuccessCriteria: () => Promise<SuccessCriteria>;
  getSettings: () => Promise<Settings>;
  ask: (question: string, history: AskTurn[]) => Promise<Answer>;
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

export function createApi(
  fetchFn: Fetch,
  getToken: () => string | null,
  cognito: CognitoConfig | null = cognitoConfig(),
): Api {
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
      if (cognito) {
        const result = await cognitoSignIn(fetchFn, cognito, email, password);
        if ("token" in result) return result.token;
        throw new ApiError(result.status, result.message);
      }
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
    restoreVersion: (version, reason) =>
      call(ConfigurationSchema, "POST", `/configuration/${String(version)}/restore`, {
        body: { reason },
      }),
    getLive: (days) => call(LiveSchema, "GET", `/live?days=${String(days)}`),
    addToEvaluation: (claimId) =>
      call(
        AddedSchema,
        "POST",
        `/live/disagreements/${encodeURIComponent(claimId)}/add-to-evaluation`,
      ),
    getThreats: () => call(ThreatCoverageSchema, "GET", "/threats"),
    getPosture: () => call(PostureSchema, "GET", "/posture"),
    suggestTrace: () => call(TraceSuggestionSchema, "GET", "/trace-suggestion"),
    getDetections: (days) => call(DetectionsSchema, "GET", `/detections?days=${String(days)}`),
    getSuccessCriteria: () => call(SuccessCriteriaSchema, "GET", "/success-criteria"),
    getSettings: () => call(SettingsSchema, "GET", "/settings"),
    ask: (question, history) =>
      call(AnswerSchema, "POST", "/ask", { body: { question, history: history.slice(-8) } }),
    getTrace: (claimId) => call(TraceSchema, "GET", `/claims/${encodeURIComponent(claimId)}/trace`),
  };
}
