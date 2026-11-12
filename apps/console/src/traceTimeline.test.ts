import type { Trace } from "./api";
import { describeCall, modelName, parseCall, timeline, unscopedCalls } from "./traceTimeline";

function step(step_id: number, kind: string, content: string, created_at: string) {
  return { step_id, kind, content, created_at };
}

const TRACE: Trace = {
  steps: [
    step(1, "screening", "No instructions found. A plain claim.", "2026-11-09T01:00:01Z"),
    step(2, "tool_call", 'get_plan {\n  "plan": "first" }', "2026-11-09T01:00:03Z"),
    step(3, "lookup", '{ "plan": "first" }', "2026-11-09T01:00:03Z"),
    step(4, "tool_call", 'get_claim_history {"customer_id": "CUS-1"}', "2026-11-09T01:00:05Z"),
    step(5, "tool_result", "[]", "2026-11-09T01:00:05Z"),
    step(6, "refusal", "The model declined to continue.", "2026-11-09T01:00:06Z"),
  ],
  model_calls: [
    {
      model: "claude-haiku-5-5",
      input_tokens: 900,
      output_tokens: 90,
      cost: 0.0001,
      latency_ms: 1800,
      created_at: "2026-11-09T01:00:01Z",
    },
    {
      model: "claude-sonnet-5-5",
      input_tokens: 4000,
      output_tokens: 100,
      cost: 0.011,
      latency_ms: 5700,
      created_at: "2026-11-09T01:00:03Z",
    },
  ],
  total_cost: 0.0111,
  total_tokens: 5090,
  summary: "Delay",
  status: "in_progress",
  outcome: null,
  config_version: null,
  average_cost: null,
};

test("a tool call's name and arguments, and what it did in plain words", () => {
  expect(parseCall('read_section {"document": "policy_wording", "number": 3}')).toEqual([
    "read_section",
    { document: "policy_wording", number: 3 },
  ]);
  expect(parseCall("get_claim {}")).toEqual(["get_claim", {}]);
  expect(parseCall("get_claim")).toEqual(["get_claim", {}]);
  expect(parseCall("get_claim not json")).toEqual(["get_claim", {}]);
  expect(describeCall("read_section", { document: "policy_wording", number: 3 })).toBe(
    "Read policy wording section 3",
  );
  expect(describeCall("search_documents", { query: "trip delay" })).toBe(
    'Searched the documents for "trip delay"',
  );
  expect(describeCall("record_decision", { decision: "refer" })).toBe(
    "Recorded the decision: refer to a handler",
  );
  expect(describeCall("get_plan", {})).toBe("Read the plan's limits");
  expect(describeCall("brand_new_tool", {})).toBe("Called brand_new_tool");
  expect(modelName("claude-sonnet-5-5")).toBe("Sonnet");
  expect(modelName("bedrock-guardrail")).toBe("bedrock-guardrail");
});

test("one timeline: model calls before the steps they led to, each call with its result", () => {
  const entries = timeline(TRACE);
  expect(
    entries.map((e) => (e.type === "model" ? `model:${modelName(e.call.model)}` : e.label)),
  ).toEqual([
    "model:Haiku",
    "Screening: no instructions found",
    "model:Sonnet",
    "Read the first plan's limits",
    "Read the customer's earlier claims",
    "The model refused to go on",
  ]);
  const plan = entries[3];
  expect(plan?.type === "step" && plan.result).toBe('{ "plan": "first" }');
  const refusal = entries[5];
  expect(refusal?.type === "step" && refusal.tone).toBe("warn");
});

test("a tool call that passed an id the session should supply is called out", () => {
  expect(unscopedCalls(TRACE)).toEqual(["get_claim_history"]);
});
