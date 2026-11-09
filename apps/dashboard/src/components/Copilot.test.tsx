import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createCopilot, type Conversation } from "../copilot";
import { Copilot } from "./Copilot";

const base: Conversation = {
  conversation_id: "conv-0123456789abcdef",
  title: "Sign off CLM-1003",
  created_at: "2026-11-08T10:00:00+00:00",
  transcript: [],
  pending: null,
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
});
