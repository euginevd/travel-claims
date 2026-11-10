// Small charts drawn as inline SVG. Sizes are SVG attributes, never inline styles, so the strict
// CSP holds; colours come from the design tokens through CSS classes.

function share(value: number): string {
  return `${String(Math.round(Math.min(Math.max(value, 0), 1) * 1000) / 10)}%`;
}

/** A small bar beside a percentage. Decorative: the number is always next to it. */
export function MiniBar({ value }: { value: number }) {
  return (
    <svg width="54" height="6" aria-hidden="true" focusable="false">
      <rect className="bar-track" width="100%" height="6" rx="3" />
      <rect className="bar-fill" width={share(value)} height="6" rx="3" />
    </svg>
  );
}

/** A full-width meter. Decorative: the figures it shows are written beside it. */
export function Meter({ value, tone }: { value: number; tone?: "spend" }) {
  return (
    <svg className="meter" height="8" aria-hidden="true" focusable="false">
      <rect className="bar-track" width="100%" height="8" rx="4" />
      <rect
        className={`bar-fill${tone ? ` ${tone}` : ""}`}
        width={share(value)}
        height="8"
        rx="4"
      />
    </svg>
  );
}

const SPARK_WIDTH = 120;
const SPARK_HEIGHT = 18;

/** The points of a trend line, oldest first, scaled to the values' own range. */
export function sparkPoints(values: number[]): [number, number][] {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = high - low;
  return values.map((value, index) => [
    Math.round((index / Math.max(values.length - 1, 1)) * SPARK_WIDTH * 10) / 10,
    // A flat trend sits in the middle; otherwise the highest value is at the top.
    range === 0
      ? SPARK_HEIGHT / 2
      : Math.round((1 - (value - low) / range) * SPARK_HEIGHT * 10) / 10,
  ]);
}

/** A small trend line with a dot on the latest value. Needs two values or more. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const points = sparkPoints(values);
  const last = points[points.length - 1] ?? [0, 0];
  return (
    <svg
      className="spark"
      viewBox={`-3 -4 ${String(SPARK_WIDTH + 6)} ${String(SPARK_HEIGHT + 8)}`}
      preserveAspectRatio="xMinYMid meet"
      role="img"
      aria-label={label}
    >
      <polyline points={points.map(([x, y]) => `${String(x)},${String(y)}`).join(" ")} />
      <circle cx={last[0]} cy={last[1]} r="2.6" />
    </svg>
  );
}

const RING = 2 * Math.PI * 15.5;

/** A ring showing a part of a whole, with "part/whole" in the middle. */
export function RingChart({ part, whole }: { part: number; whole: number }) {
  const filled = whole > 0 ? (part / whole) * RING : 0;
  return (
    <svg className="ringchart" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
      <circle className="ring-track" cx="18" cy="18" r="15.5" />
      {filled > 0 && (
        <circle
          className="ring-value"
          cx="18"
          cy="18"
          r="15.5"
          strokeDasharray={`${filled.toFixed(2)} ${RING.toFixed(2)}`}
          transform="rotate(-90 18 18)"
        />
      )}
      <text className="ring-label" x="18" y="21" textAnchor="middle">
        {part}/{whole}
      </text>
    </svg>
  );
}
