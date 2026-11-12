// Test helpers: data shaped like the api's responses, and a fake fetch that answers by route.
import type { Engineer, Posture } from "./api";

export const SAM: Engineer = {
  engineer_id: "ENG-01",
  name: "Sam Carter",
  role: "AI Engineer",
  email: "sam.carter@undercover.example",
};

type Answer = [status: number, body: unknown];
export type Routes = Record<string, (body: unknown) => Answer>;

export interface FakeFetch {
  (input: string, init?: RequestInit): Promise<Response>;
  calls: { method: string; path: string; body: unknown; auth: string | null }[];
}

// Answers `${method} ${path}` from the routes; anything else is a 404.
export function fakeFetch(routes: Routes): FakeFetch {
  const calls: FakeFetch["calls"] = [];
  const fetchFn = (input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body: unknown =
      typeof init?.body === "string" ? JSON.parse(init.body) : (init?.body ?? undefined);
    const headers = new Headers(init?.headers);
    calls.push({ method, path: input, body, auth: headers.get("Authorization") });
    const route = routes[`${method} ${input}`];
    const [status, answer] = route ? route(body) : [404, { detail: "Not found" }];
    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  return Object.assign(fetchFn, { calls });
}

// The security posture after one red-team run whose attacks the first layer all stopped.
export const POSTURE: Posture = {
  verdict: "gap",
  redteam: {
    run_at: "2026-11-08T10:57:00Z",
    run_by: "Sam Carter",
    config_version: 3,
    attacks: 2,
    held: 2,
    paid: 0,
  },
  layers: [
    {
      key: "screening",
      name: "Guardrail and hidden-instruction check",
      what: "Reads first",
      reached: 2,
      stopped: 2,
    },
    { key: "agent", name: "Claim agent", what: "Scoped tools", reached: 0, stopped: 0 },
    { key: "limits", name: "Limits in code", what: "Payout in code", reached: 0, stopped: 0 },
    { key: "sign_off", name: "A person signs off", what: "Held payouts", reached: 0, stopped: 0 },
  ],
  inventory: { agents: 7, models: 2, risks: 12, live_version: 4 },
  controls: {
    risks: 12,
    with_control: 12,
    tested: 6,
    llm_tested: 4,
    llm_total: 7,
    agentic_tested: 2,
    agentic_total: 5,
  },
  issues: [
    {
      severity: "high",
      title: "The layers behind the hidden-instruction check have never faced an attack",
      detail: "Every attack was stopped first.",
      link: "redteam",
    },
    {
      severity: "medium",
      title: "No attack tests LLM04 data and model poisoning",
      detail: "The control: memory scoped per customer.",
      link: "coverage",
    },
    {
      severity: "low",
      title: "Agent version 4 is in use without a red-team run",
      detail: "Run the red team.",
      link: "redteam",
    },
  ],
  detections: { guardrail: 0, hidden_instruction: 2, refusal: 0, held: 1 },
  detection_days: 14,
  readiness: {
    payouts_paused: false,
    live_version: 4,
    tested_version: 3,
    live_version_red_teamed: false,
  },
};
