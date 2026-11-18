import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../api";
import { runs } from "./AgentTeam";

const read = (id: string, claim: string | null = "CLM-1026"): AgentEvent => ({
  event_id: id,
  at: "2026-11-18T08:00:00Z",
  agent: "claim_agent",
  to: "context",
  kind: "read",
  tool: "",
  claim_id: claim,
});

describe("runs", () => {
  it("shows back-to-back repeats of a step once, with a count", () => {
    const shown = runs([read("1"), read("2"), read("3"), read("4", "CLM-1027"), read("5")]);
    expect(shown.map((r) => [r.event.event_id, r.count])).toEqual([
      ["1", 3],
      ["4", 1],
      ["5", 1],
    ]);
  });
});

describe("an agent's address", () => {
  it("opens the agents map on that agent", async () => {
    const { agentHref, parseHash } = await import("../useHashRoute");
    expect(parseHash(agentHref("judge"))).toEqual({ page: "agents", agent: "judge" });
    expect(parseHash("#/agents/../x")).toEqual({ page: "overview" });
  });
});
