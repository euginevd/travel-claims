import { Sparkle } from "lucide-react";

// The one marker for anything an AI produced, used the same way everywhere (design system 10).
export function AiMark({ label = "AI" }: { label?: string }) {
  return (
    <span className="ai-mark">
      <Sparkle size={14} strokeWidth={2} aria-hidden="true" />
      {label}
    </span>
  );
}
