import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi, FeedbackSchema } from "../api";
import feedback from "../fixtures/feedback.json";
import { fakeFetch } from "../testing";
import { Feedback } from "./Feedback";

test("the api's feedback response parses", () => {
  expect(FeedbackSchema.parse(feedback).helpful).toBe(false);
});

test("a thumbs down on an answer offers a comment and changes the same vote", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    "POST /api/customer/feedback": (body) => [
      200,
      { feedback_id: 7, subject: "answer", claim_id: null, comment: null, ...(body as object) },
    ],
  });
  render(
    <Feedback api={createApi(fetchFn, () => "t")} subject="answer" question="Am I covered?" />,
  );
  await user.click(screen.getByRole("button", { name: "Not helpful" }));
  await user.type(await screen.findByLabelText("What was missing? (optional)"), "Too vague");
  await user.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText("Thanks")).toBeInTheDocument();
  expect(fetchFn.calls.map((c) => c.body)).toEqual([
    { subject: "answer", helpful: false, question: "Am I covered?" },
    {
      subject: "answer",
      helpful: false,
      question: "Am I covered?",
      comment: "Too vague",
      feedback_id: 7,
    },
  ]);
  expect(screen.getByRole("button", { name: "Not helpful" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("a decision's vote shows the one given before and says thanks", async () => {
  const user = userEvent.setup();
  const saved = { ...feedback, helpful: true, comment: null };
  const fetchFn = fakeFetch({
    "GET /api/customer/claims/CLM-1001/feedback": () => [200, feedback],
    "POST /api/customer/feedback": () => [200, saved],
  });
  render(
    <Feedback
      api={createApi(fetchFn, () => "t")}
      subject="decision"
      claimId="CLM-1001"
      prompt="Was this explanation clear?"
    />,
  );
  const no = await screen.findByRole("button", { name: "No", pressed: true });
  expect(no).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Yes" }));
  expect(await screen.findByRole("button", { name: "Yes", pressed: true })).toBeInTheDocument();
  expect(fetchFn.calls.at(-1)?.body).toEqual({
    subject: "decision",
    claim_id: "CLM-1001",
    helpful: true,
  });
});
