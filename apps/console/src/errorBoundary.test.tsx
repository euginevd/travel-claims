import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "@undercover/web-core/ErrorBoundary";

const wayBack = (
  <>
    go <a href="#/">back to the scoreboard</a>
  </>
);

function Broken(): never {
  throw new Error("A field was missing");
}

test("a page that fails to render shows a way back, not a blank app", () => {
  const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
  render(
    <ErrorBoundary wayBack={wayBack}>
      <Broken />
    </ErrorBoundary>,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
  expect(screen.getByRole("link", { name: "back to the scoreboard" })).toHaveAttribute(
    "href",
    "#/",
  );
  quiet.mockRestore();
});

test("a page that renders is shown as it is", () => {
  render(
    <ErrorBoundary wayBack={wayBack}>
      <p>The queue</p>
    </ErrorBoundary>,
  );
  expect(screen.getByText("The queue")).toBeInTheDocument();
});
