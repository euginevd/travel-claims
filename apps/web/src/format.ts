import type { DecisionKind, Status, StepKind } from "./api";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const day = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" });
const moment = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

export function dollars(amount: number): string {
  return money.format(amount);
}

export function date(value: string): string {
  return day.format(new Date(value));
}

export function when(value: string): string {
  return moment.format(new Date(value));
}

export const STATUS_LABELS: Record<Status, string> = {
  waiting: "Waiting",
  in_progress: "Agent working",
  waiting_for_sign_off: "Waiting for sign-off",
  sent_back: "Sent back",
  decided: "Decided",
  left_for_handler: "Left for a handler",
};

export const DECISION_LABELS: Record<DecisionKind, string> = {
  approve: "Approved",
  decline: "Declined",
  refer: "Referred to a handler",
};

export const STEP_LABELS: Record<StepKind, string> = {
  screening: "Hidden-instruction check",
  message: "Agent",
  tool_call: "Tool call",
  tool_result: "Tool result",
  lookup: "Looked up",
  refusal: "Refused",
  error: "Something went wrong",
  sent_back: "Handler's note",
};
