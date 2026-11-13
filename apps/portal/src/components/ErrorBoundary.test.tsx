import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

function Broken(): never {
  throw new Error("boom");
}

test("a page that fails to render says so and links back to the start", () => {
  const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
  render(
    <ErrorBoundary>
      <Broken />
    </ErrorBoundary>,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
  expect(screen.getByRole("link", { name: "start again" })).toHaveAttribute("href", "#/");
  quiet.mockRestore();
});
