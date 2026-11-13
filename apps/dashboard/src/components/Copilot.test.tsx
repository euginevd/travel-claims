import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createCopilot, type Conversation } from "../copilot";
import { Copilot, turnLine } from "./Copilot";

const base: Conversation = {
  conversation_id: "conv-0123456789abcdef",
  title: "Sign off CLM-1003",
  created_at: "2026-11-08T10:00:00+00:00",
  transcript: [],
  pending: null,
  steps: 0,
  model_calls: 0,
  seconds: 0,
  cost_usd: 0,
};

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("asks, shows the sign-off card and pays only when the handler confirms", async () => {
  const user = userEvent.setup();
  const posted: { path: string; body: unknown }[] = [];
  const fetchFn = (input: string, init?: RequestInit) => {
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    posted.push({ path: input, body });
    if (input === "/api/copilot/conversations" && init?.method === "GET") return respond([]);
    if (input === "/api/copilot/conversations") return respond(base, 201);
    if (input.endsWith("/messages")) {
      return respond({
        ...base,
        transcript: [
          { role: "user", text: "Sign off CLM-1003" },
          { kind: "step", title: "Read CLM-1003", detail: "" },
        ],
        pending: {
          kind: "confirm",
          title: "Sign off CLM-1003?",
          detail: "Covered medical costs.",
          claim_id: "CLM-1003",
          customer: "Aiko Tanaka",
          amount: 3750,
        },
      });
    }
    return respond({
      ...base,
      transcript: [{ role: "assistant", text: "Signed off and paid." }],
      steps: 3,
      model_calls: 2,
      seconds: 4.23,
      cost_usd: 0.0121,
    });
  };
  const copilot = createCopilot(
    (input, init) => Promise.resolve(fetchFn(input, init)),
    () => "t",
  );
  render(<Copilot copilot={copilot} onClose={() => undefined} />);

  await user.type(screen.getByLabelText("Your question"), "Sign off CLM-1003");
  await user.click(screen.getByRole("button", { name: "Ask" }));

  expect(await screen.findByText(/This pays/)).toHaveTextContent(
    "This pays $3,750.00 to Aiko Tanaka",
  );
  expect(posted.some((p) => p.path.endsWith("/confirm"))).toBe(false);

  await user.click(screen.getByRole("button", { name: "Sign off and pay" }));
  expect(await screen.findByText("Signed off and paid.")).toBeInTheDocument();
  const confirm = posted.find((p) => p.path.endsWith("/confirm"));
  expect(confirm?.body).toEqual({ answer: "sign_off" });
  expect(screen.getByText("3 steps · 4.2 s · $0.012")).toBeInTheDocument();
});

test("a dispatch waits on its own card and starts only on its button", async () => {
  const user = userEvent.setup();
  const answers: unknown[] = [];
  const waiting = {
    ...base,
    transcript: [{ role: "user", text: "Dispatch 3 agents" }],
    pending: { kind: "confirm", action: "dispatch", title: "", detail: "", agents: 3, waiting: 4 },
  };
  const fetchFn = (input: string, init?: RequestInit) => {
    if (input === "/api/copilot/conversations" && init?.method === "GET") return respond([]);
    if (input === "/api/copilot/conversations") return respond(base, 201);
    if (input.endsWith("/messages")) return respond(waiting);
    answers.push(typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
    return respond({
      ...base,
      transcript: [{ role: "assistant", text: "Dispatch 7 is running." }],
    });
  };
  const copilot = createCopilot(
    (input, init) => Promise.resolve(fetchFn(input, init)),
    () => "t",
  );
  render(<Copilot copilot={copilot} onClose={() => undefined} />);

  await user.type(screen.getByLabelText("Your question"), "Dispatch 3 agents");
  await user.click(screen.getByRole("button", { name: "Ask" }));

  expect(await screen.findByRole("heading", { name: "Start a dispatch?" })).toBeInTheDocument();
  expect(screen.getByText(/through the 4 claims waiting now/)).toHaveTextContent("3 claim agents");
  expect(answers).toEqual([]);

  await user.click(screen.getByRole("button", { name: "Start the dispatch" }));
  expect(await screen.findByText("Dispatch 7 is running.")).toBeInTheDocument();
  expect(answers).toEqual([{ answer: "confirm" }]);
});

test("the turn line counts one step in the singular", () => {
  expect(turnLine({ steps: 1, seconds: 0.84, cost_usd: 0.0004 })).toBe("1 step · 0.8 s · $0.000");
});

test("an answer is laid out with its sources, and the next question asks again", async () => {
  const user = userEvent.setup();
  const asked: unknown[] = [];
  const answer = {
    role: "assistant",
    text: "Two claims wait for you.",
    headline: "Two claims wait for you.",
    points: [{ text: "CLM-1004 needs **sign-off**", source: 1 }],
    sources: ["What needs me"],
    next: "Sign off CLM-1004?",
  };
  const fetchFn = (input: string, init?: RequestInit) => {
    if (input === "/api/copilot/conversations" && init?.method === "GET") return respond([]);
    if (input === "/api/copilot/conversations") return respond(base, 201);
    asked.push(typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
    return respond({ ...base, transcript: [{ role: "user", text: "What needs me?" }, answer] });
  };
  render(
    <Copilot
      copilot={createCopilot(
        (i, n) => Promise.resolve(fetchFn(i, n)),
        () => "t",
      )}
      onClose={() => undefined}
    />,
  );
  await user.type(screen.getByRole("textbox"), "What needs me?{Enter}");
  expect(await screen.findByText("Two claims wait for you.")).toBeInTheDocument();
  expect(screen.getByText("sign-off").tagName).toBe("STRONG");
  expect(screen.getByRole("list", { name: "Sources" })).toHaveTextContent("What needs me");
  await user.click(screen.getByRole("button", { name: "Sign off CLM-1004?" }));
  expect(asked.at(-1)).toEqual({ text: "Sign off CLM-1004?" });
});

test("each step in a turn is numbered so the steps appear in turn", async () => {
  const { stepOrder } = await import("./Copilot");
  const transcript = [
    { role: "user" as const, text: "Hi" },
    { kind: "step" as const, title: "One" },
    { kind: "step" as const, title: "Two" },
    { role: "assistant" as const, text: "Done" },
  ];
  expect([1, 2].map((i) => stepOrder(transcript, i))).toEqual([0, 1]);
});
