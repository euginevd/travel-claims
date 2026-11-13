import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WattlePanel, type WattleAnswer } from "./Wattle";

const ANSWER: WattleAnswer = {
  answer: "Run 3 matched 5 of 5.",
  sources: ["Run 3"],
  suggest: "",
  screened: false,
};

test("the panel takes focus on open, and Escape closes it only from inside", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(
    <>
      <button type="button">Elsewhere</button>
      <WattlePanel ask={() => Promise.resolve(ANSWER)} scope="" starters={[]} onClose={onClose} />
    </>,
  );
  expect(screen.getByLabelText("Your question")).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledOnce();

  screen.getByRole("button", { name: "Elsewhere" }).focus();
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledOnce();
});

test("a new conversation while an answer is coming drops that answer", async () => {
  const user = userEvent.setup();
  let answer: (found: WattleAnswer) => void = () => undefined;
  const ask = () =>
    new Promise<WattleAnswer>((resolve) => {
      answer = resolve;
    });
  render(<WattlePanel ask={ask} scope="" starters={[]} onClose={vi.fn()} />);
  await user.type(screen.getByLabelText("Your question"), "How accurate is it?{Enter}");
  expect(screen.getByRole("status")).toHaveTextContent("Looking that up");

  await user.click(screen.getByRole("button", { name: "New conversation" }));
  expect(screen.queryByText("How accurate is it?")).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  answer(ANSWER);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByText("Run 3 matched 5 of 5.")).not.toBeInTheDocument();

  // The new conversation can ask at once.
  await user.type(screen.getByLabelText("Your question"), "And now?{Enter}");
  answer(ANSWER);
  expect(await screen.findByText("Run 3 matched 5 of 5.")).toBeInTheDocument();
});
