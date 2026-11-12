/*
 * A claim's trace as a person reads it: steps and model calls in one timeline, each tool call
 * with its result and a plain-English label, and the security checks worth seeing at a glance.
 * Pure functions over the api's trace, so they're tested without a page.
 */
import type { Trace } from "./api";

type Step = Trace["steps"][number];
type ModelCall = Trace["model_calls"][number];
type Args = Record<string, unknown>;

export type Entry =
  | { type: "model"; call: ModelCall; at: string }
  | {
      type: "step";
      kind: string;
      label: string;
      tone: "ok" | "warn" | "plain";
      content: string;
      result: string | null;
      at: string;
    };

// The ids a tool must never take from the model: they come from the session (spec 23).
const SCOPED = ["claim_id", "customer_id", "policy_id"];

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/** A tool call's name and arguments: "get_plan {"plan": "first"}" -> ["get_plan", {plan}]. */
export function parseCall(content: string): [name: string, args: Args] {
  const trimmed = content.trim();
  const space = trimmed.search(/\s/);
  if (space < 0) return [trimmed, {}];
  const name = trimmed.slice(0, space);
  try {
    const parsed: unknown = JSON.parse(trimmed.slice(space + 1));
    return [name, parsed && typeof parsed === "object" ? (parsed as Args) : {}];
  } catch {
    return [name, {}];
  }
}

const DECISIONS: Record<string, string> = {
  approve: "approve",
  decline: "decline",
  refer: "refer to a handler",
};

/** What a tool call did, in plain words. */
export function describeCall(name: string, args: Args): string {
  const quoted = (key: string) => `"${text(args[key])}"`;
  switch (name) {
    case "get_claim":
      return "Read the claim";
    case "get_policy":
      return "Read the customer's policy";
    case "get_claim_history":
      return "Read the customer's earlier claims";
    case "get_claim_rules":
      return "Read the claims rules";
    case "get_plan":
      return text(args.plan)
        ? `Read the ${text(args.plan)} plan's limits`
        : "Read the plan's limits";
    case "search_documents":
      return `Searched the documents for ${quoted("query")}`;
    case "read_section":
      return `Read ${text(args.document).replaceAll("_", " ") || "a document"} section ${text(args.number)}`;
    case "search_reference_data":
      return `Searched the reference data for ${quoted("query")}`;
    case "lookup_term":
      return `Looked up ${quoted("term")}`;
    case "describe_fields":
      return `Looked up the fields of ${text(args.record) || "a record"}`;
    case "check_documents":
      return "Asked the document checker";
    case "review_medical":
      return "Asked the medical reviewer";
    case "find_duplicate_receipts":
      return "Checked for duplicate receipts";
    case "search_memory":
      return "Searched what it remembers about the customer";
    case "calculate_payout":
      return "Worked out the payout";
    case "record_decision": {
      const decision = DECISIONS[text(args.decision)] ?? text(args.decision);
      return decision ? `Recorded the decision: ${decision}` : "Recorded the decision";
    }
    case "run_lookup_program":
      return "Ran a lookup program";
    default:
      return `Called ${name}`;
  }
}

const RESULT_KINDS = new Set(["tool_result", "lookup"]);

/** One step as a timeline entry, in plain words. */
function stepEntry(step: Step): Exclude<Entry, { type: "model" }> {
  const base = {
    type: "step" as const,
    kind: step.kind,
    content: step.content,
    at: step.created_at,
  };
  switch (step.kind) {
    case "screening": {
      const flagged = step.content.startsWith("Instructions found");
      return {
        ...base,
        label: flagged
          ? "Screening found instructions in the claim"
          : "Screening: no instructions found",
        tone: flagged ? "warn" : "ok",
        result: null,
      };
    }
    case "tool_call": {
      const [name, args] = parseCall(step.content);
      return { ...base, label: describeCall(name, args), tone: "plain", result: null };
    }
    case "refusal":
      return { ...base, label: "The model refused to go on", tone: "warn", result: null };
    case "error":
      return { ...base, label: "Something went wrong", tone: "warn", result: null };
    case "sent_back":
      return { ...base, label: "A handler sent it back", tone: "plain", result: null };
    case "message":
      return { ...base, label: "The agent wrote a note", tone: "plain", result: null };
    default:
      return { ...base, label: step.kind.replaceAll("_", " "), tone: "plain", result: null };
  }
}

/** Steps and model calls in time order, each tool call carrying its result. A model call goes
 * before a step recorded in the same second, since the call is what led to it. */
export function timeline(trace: Trace): Entry[] {
  const steps: Exclude<Entry, { type: "model" }>[] = [];
  for (const step of trace.steps) {
    const last = steps.at(-1);
    if (RESULT_KINDS.has(step.kind) && last?.kind === "tool_call" && last.result === null) {
      last.result = step.content;
      continue;
    }
    steps.push(stepEntry(step));
  }
  const calls: Entry[] = trace.model_calls.map((call) => ({
    type: "model",
    call,
    at: call.created_at,
  }));
  const merged: Entry[] = [];
  let s = 0;
  let c = 0;
  while (s < steps.length || c < calls.length) {
    const step = steps[s];
    const call = calls[c];
    if (call && (!step || call.at <= step.at)) {
      merged.push(call);
      c += 1;
    } else if (step) {
      merged.push(step);
      s += 1;
    }
  }
  return merged;
}

/** The tool calls that passed an id the session should have supplied, by tool name. */
export function unscopedCalls(trace: Trace): string[] {
  return trace.steps
    .filter((step) => step.kind === "tool_call")
    .map((step) => parseCall(step.content))
    .filter(([, args]) => SCOPED.some((key) => key in args))
    .map(([name]) => name);
}

/** "claude-sonnet-5-5" -> "Sonnet". */
export function modelName(model: string): string {
  const family = /claude-([a-z]+)/.exec(model)?.[1];
  return family ? family.charAt(0).toUpperCase() + family.slice(1) : model;
}
