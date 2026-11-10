import type { ReactNode } from "react";

/** A wide table scrolls sideways inside its card, never the page. */
export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    // A scrollable region must take focus so keyboard users can scroll it (WCAG 2.1.1).
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className="table-wrap" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
