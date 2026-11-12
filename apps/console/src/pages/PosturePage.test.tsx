import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi, type Posture } from "../api";
import { fakeFetch, POSTURE } from "../testing";
import { PosturePage } from "./PosturePage";

function page(posture: Posture | (() => [number, unknown])) {
  const answer =
    typeof posture === "function" ? posture : () => [200, posture] as [number, unknown];
  const fetchFn = fakeFetch({ "GET /api/engineering/posture": answer });
  render(<PosturePage api={createApi(fetchFn, () => "t")} />);
}

test("shows the verdict, four figures, each layer and the gaps, most severe first", async () => {
  page(POSTURE);
  expect(
    await screen.findByText("Every attack was stopped, but parts are untested"),
  ).toBeInTheDocument();
  expect(screen.getByText(/2 of 2 attacks were stopped and \$0.00 was paid/)).toBeInTheDocument();

  const tiles = screen.getByRole("list", { name: "Security at a glance" });
  expect(within(tiles).getByText("2 of 2")).toBeInTheDocument();
  expect(within(tiles).getByText("6 of 12")).toBeInTheDocument();
  expect(within(tiles).getByText(/OWASP LLM 4 of 7/)).toBeInTheDocument();
  expect(within(tiles).getByText("On")).toBeInTheDocument();

  expect(screen.getByRole("heading", { name: "Defence in depth" })).toBeInTheDocument();
  expect(screen.getByText("Reached by 2 · stopped 2")).toBeInTheDocument();
  expect(screen.getAllByText("Untested: no attack reached it")).toHaveLength(3);

  const [, first, second] = within(screen.getByRole("region", { name: "Gaps table" })).getAllByRole(
    "row",
  );
  expect(first).toHaveTextContent("High");
  expect(first).toHaveTextContent("never faced an attack");
  expect(second).toBeDefined();
});

test("before any red-team run it says so and where to start", async () => {
  page({
    ...POSTURE,
    verdict: "untested",
    redteam: null,
    layers: POSTURE.layers.map((layer) => ({ ...layer, reached: 0, stopped: 0 })),
    issues: [],
  });
  expect(await screen.findByText("No attacks run yet")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "No red-team run yet" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Go to the red team" })).toHaveAttribute(
    "href",
    "#/redteam",
  );
  expect(screen.getByText(/No gaps/)).toBeInTheDocument();
});

test("a failed attack is called out", async () => {
  if (!POSTURE.redteam) throw new Error("The fixture has a red-team run");
  page({
    ...POSTURE,
    verdict: "failing",
    redteam: { ...POSTURE.redteam, held: 1, paid: 950 },
    layers: POSTURE.layers.map((layer) =>
      layer.key === "screening" ? { ...layer, stopped: 1 } : { ...layer, reached: 1 },
    ),
  });
  expect(await screen.findByText("An attack got money out")).toBeInTheDocument();
  expect(screen.getByText(/1 attack got through every layer/)).toBeInTheDocument();
});

test("a posture that's holding shows its good verdict", async () => {
  page({ ...POSTURE, verdict: "holding", issues: [] });
  expect(await screen.findByText("Every attack was stopped")).toBeInTheDocument();
});

test("an error offers a retry", async () => {
  const user = userEvent.setup();
  let fail = true;
  page(() => (fail ? [500, { detail: "Down" }] : [200, POSTURE]));
  expect(await screen.findByRole("alert")).toHaveTextContent("Down");
  fail = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(
    await screen.findByText("Every attack was stopped, but parts are untested"),
  ).toBeInTheDocument();
});
