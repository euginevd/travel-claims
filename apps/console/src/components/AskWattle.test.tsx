import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi } from "../api";
import { fakeFetch } from "../testing";
import { AskWattle, startersFor } from "./AskWattle";

test("answers an engineer's question with its sources", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    "POST /api/engineering/ask": () => [
      200,
      { answer: "Run 3 matched 5 of 5.", sources: ["Run 3"], suggest: "", screened: false },
    ],
  });
  const closed = vi.fn();
  render(
    <AskWattle
      api={createApi(fetchFn, () => "t")}
      route={{ page: "scoreboard" }}
      onClose={closed}
    />,
  );
  await user.click(screen.getByRole("button", { name: "How accurate is the agent right now?" }));
  expect(await screen.findByText("Run 3 matched 5 of 5.")).toBeInTheDocument();
  expect(screen.getByText("Run 3")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Close Wattle AI" }));
  expect(closed).toHaveBeenCalled();
});

test("the starters fit the page", () => {
  expect(startersFor({ page: "run", runId: 7 })[0]).toBe("Summarise run 7");
  for (const page of [
    "improvement",
    "redteam",
    "trace",
    "coverage",
    "posture",
    "detections",
  ] as const) {
    expect(startersFor({ page }).length).toBeGreaterThan(1);
  }
});

test("says when Wattle AI can't answer and starts over", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    "POST /api/engineering/ask": () => [503, { detail: "The assistant isn't available right now" }],
  });
  render(
    <AskWattle api={createApi(fetchFn, () => "t")} route={{ page: "trace" }} onClose={vi.fn()} />,
  );
  await user.type(screen.getByLabelText("Your question"), "Explain CLM-1001");
  await user.click(screen.getByRole("button", { name: "Ask" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("isn't available");
  await user.click(screen.getByRole("button", { name: "New conversation" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText("Ask Wattle AI anything")).toBeInTheDocument();
});
