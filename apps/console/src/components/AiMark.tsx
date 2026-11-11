import { Sparkle } from "lucide-react";

// The one marker for anything an AI produced, used the same way everywhere (code-standards 29).
export function AiMark({ label = "AI" }: { label?: string }) {
  return (
    <span className="ai-mark">
      <Sparkle size={12} strokeWidth={1.75} aria-hidden="true" />
      {label}
    </span>
  );
}
