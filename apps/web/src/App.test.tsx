import { render, screen } from "@testing-library/react";
import { App } from "./App";

test("shows the dashboard's heading", () => {
  render(<App />);
  expect(screen.getByRole("heading", { level: 1, name: "UnderCover claims" })).toBeInTheDocument();
});
