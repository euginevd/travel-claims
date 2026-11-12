import type { ReasonCode, StepKind } from "./api";

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

/** A code like "trip_delay" as words: "Trip delay". */
export function words(code: string): string {
  const spaced = code.replaceAll("_", " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
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

/** A file size as people read it: kilobytes, or megabytes from 1 MB. */
export function kilobytes(size: number): string {
  return size < 1024 * 1024
    ? `${String(Math.max(1, Math.round(size / 1024)))} KB`
    : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export const REASON_LABELS: Record<ReasonCode, string> = {
  policy_wording: "Policy wording",
  evidence: "Evidence",
  calculation: "Calculation",
  customer_circumstances: "Customer's circumstances",
  suspected_fraud: "Suspected fraud",
  other: "Other",
};

const TOOL_WORDS: Record<string, string> = {
  get_claim: "Read the claim",
  get_policy: "Read the policy",
  get_claim_history: "Checked earlier claims",
  calculate_payout: "Worked out the payout",
  record_decision: "Recorded the decision",
  lookup_term: "Looked up a term",
  describe_fields: "Checked what a field means",
  get_plan: "Read the plan's limits",
  get_claim_rules: "Read the claim rules",
  search_reference_data: "Checked outside facts",
  search_documents: "Searched the policy documents",
  read_section: "Read a section",
  check_documents: "Asked the document checker",
  find_duplicate_receipts: "Checked for receipts used on other claims",
  review_medical: "Asked the medical reviewer",
  search_memory: "Checked what it knows about the customer",
};

/** A step in plain words for the activity rail, or null for steps only the trace shows. */
export function plainStep(kind: StepKind, content: string): string | null {
  switch (kind) {
    case "screening":
      return content.startsWith("Instructions found")
        ? "Found instructions hidden in the claim"
        : "Checked for hidden instructions";
    case "tool_call": {
      const name = content.split(" ", 1)[0] ?? "";
      const section = /"document":\s*"(\w+)",\s*"number":\s*(\d+)/.exec(content);
      if (name === "read_section" && section) {
        const document = section[1] === "claims_manual" ? "claims manual" : "policy wording";
        return `Read the ${document}, section ${section[2] ?? ""}`;
      }
      return TOOL_WORDS[name] ?? null;
    }
    case "refusal":
      return "The model declined to continue";
    case "error":
      return `Something went wrong: ${content.slice(0, 120)}`;
    case "sent_back":
      return `Sent back: ${content}`;
    case "message":
      return content.startsWith("Paid") ||
        content.includes("signed off") ||
        content.includes("overrode")
        ? content
        : null;
    default:
      return null;
  }
}
