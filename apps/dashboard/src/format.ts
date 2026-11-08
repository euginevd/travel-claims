import type { StepKind } from "./api";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
// A date-only value like "2026-06-24" is a calendar day, not a moment: read it in UTC so it
// doesn't move to the day before in timezones west of Greenwich.
const day = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const moment = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

export function dollars(amount: number): string {
  return money.format(amount);
}

// Dates come from records and from agent output, so a bad one is shown as it came, never thrown.
function formatted(format: Intl.DateTimeFormat, value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : format.format(parsed);
}

export function date(value: string): string {
  return formatted(day, value);
}

export function when(value: string): string {
  return formatted(moment, value);
}

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
