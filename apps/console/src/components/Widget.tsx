import type { ReactNode } from "react";

/** A square figure: what it is, the number, a small chart or meter, and a line saying what it
 * means. A link when it leads somewhere; `tone` marks one that needs doing. */
export function Widget({
  label,
  value,
  sub,
  href,
  tone,
  children,
}: {
  label: string;
  value: string;
  sub: ReactNode;
  href?: string;
  tone?: "warn" | "good";
  children?: ReactNode;
}) {
  const className = `widget${tone ? ` widget-${tone}` : ""}`;
  const inner = (
    <>
      <span className="widget-label">{label}</span>
      <span className="widget-value">{value}</span>
      <span className="widget-chart">{children}</span>
      <span className="widget-sub">{sub}</span>
    </>
  );
  return href ? (
    <a className={className} href={href}>
      {inner}
    </a>
  ) : (
    <div className={className}>{inner}</div>
  );
}
