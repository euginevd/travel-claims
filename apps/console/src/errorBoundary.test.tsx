import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./components/ErrorBoundary";

function Broken(): never {
  throw new Error("A field was missing");
}

test("a page that fails to render shows a way back, not a blank app", () => {
  const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
  render(
    <ErrorBoundary>
      <Broken />
    </ErrorBoundary>,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
  expect(screen.getByRole("link", { name: "back to the posture page" })).toHaveAttribute(
    "href",
    "#/",
  );
  quiet.mockRestore();
});

test("a page that renders is shown as it is", () => {
  render(
    <ErrorBoundary>
      <p>The queue</p>
    </ErrorBoundary>,
  );
  expect(screen.getByText("The queue")).toBeInTheDocument();
});
