import { CircleCheck, CircleX, TriangleAlert, type LucideIcon } from "lucide-react";
import { useId } from "react";
import type { Check, Step } from "../api";

const ORDER: Record<Check["result"], number> = { fail: 0, warn: 1, pass: 2 };
const ICONS: Record<Check["result"], { Icon: LucideIcon; label: string }> = {
  pass: { Icon: CircleCheck, label: "Passed" },
  warn: { Icon: TriangleAlert, label: "Warning" },
  fail: { Icon: CircleX, label: "Failed" },
};

/** Exceptions first: failures, then warnings, then what passed. */
export function sorted(checks: Check[]): Check[] {
  return [...checks].sort((a, b) => ORDER[a.result] - ORDER[b.result]);
}

// The specialists the claim agent consults, by the source it cites and the tool it calls.
const SPECIALISTS: Record<string, string> = {
  "document checker": "check_documents",
  "duplicate check": "find_duplicate_receipts",
  "medical reviewer": "review_medical",
};

/** What a specialist found: the result the agent recorded after calling it. */
function specialistFinding(tool: string, steps: Step[]): string | null {
  const called = steps.findIndex(
    (step) => step.kind === "tool_call" && step.content.startsWith(tool),
  );
  const answer = called >= 0 ? steps[called + 1] : undefined;
  return answer ? answer.content.slice(0, 280) : null;
}

/** What the source chip shows on hover: for a document section, the agent's lookup of it; for a
 * specialist, what it found; for a receipt, where to find it. */
export function previewOf(source: string, steps: Step[]): string {
  const specialist = SPECIALISTS[source.toLowerCase()];
  if (specialist) {
    return specialistFinding(specialist, steps) ?? `${source}: no findings recorded.`;
  }
  const receipt = /^Receipt (\d+)$/i.exec(source);
  if (receipt) return `The customer's receipt ${receipt[1] ?? ""}, under Evidence.`;
  const section = /(policy wording|claims manual)\D*(\d+)/i.exec(source);
  if (section) {
    const file = section[1]?.toLowerCase().startsWith("policy")
      ? "policy_wording"
      : "claims_manual";
    const number = new RegExp(`"number":\\s*${section[2] ?? ""}\\b`);
    const found = steps.find(
      (step) =>
        step.kind === "lookup" &&
        step.sources.some((s) => s.file.startsWith(file)) &&
        number.test(step.content),
    );
    if (found) return found.content.slice(0, 280);
    return `${source}: the agent didn't record reading it.`;
  }
  return source === "Claim" ? "The customer's own words, under Evidence." : source;
}

/** A check's source as a chip: hover or focus previews it, and pressing it goes to the
 * evidence for a receipt or the customer's words. */
function SourceChip({ source, steps }: { source: string; steps: Step[] }) {
  const id = useId();
  if (!source) return null;
  return (
    <span className="source-chip-wrap">
      <button
        type="button"
        className="source-chip"
        aria-describedby={id}
        onClick={() => {
          document.getElementById("story-heading")?.scrollIntoView({ block: "start" });
        }}
      >
        {source}
      </button>
      <span id={id} className="source-preview" role="tooltip" dir="auto">
        {previewOf(source, steps)}
      </span>
    </span>
  );
}

export function Checklist({ checks, steps }: { checks: Check[]; steps: Step[] }) {
  if (checks.length === 0) return null;
  return (
    <ul className="checklist" aria-label="What was checked">
      {sorted(checks).map((check, index) => {
        const { Icon, label } = ICONS[check.result];
        return (
          <li key={index} className={`check check-${check.result}`}>
            <Icon size={16} strokeWidth={2} aria-label={label} role="img" />
            <span className="check-text" dir="auto">
              {check.label}
              {check.detail && <span className="muted small"> · {check.detail}</span>}
            </span>
            <SourceChip source={check.source} steps={steps} />
          </li>
        );
      })}
    </ul>
  );
}
