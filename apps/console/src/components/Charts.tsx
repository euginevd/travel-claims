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

const BARS_WIDTH = 300;
const BARS_HEIGHT = 56;
const BAR_GAP = 2;

/** One bar a value, oldest first, on a shared baseline. Each bar names its value on hover; the
 * label says the whole series for a screen reader. */
export function BarSeries({
  values,
  label,
}: {
  values: { name: string; value: number }[];
  label: string;
}) {
  if (values.length === 0) return null;
  const high = Math.max(...values.map((v) => v.value), 1);
  const slot = BARS_WIDTH / values.length;
  return (
    <svg
      className="barseries"
      viewBox={`0 0 ${String(BARS_WIDTH)} ${String(BARS_HEIGHT + 1)}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <line
        className="bar-base"
        x1="0"
        x2={BARS_WIDTH}
        y1={BARS_HEIGHT + 0.5}
        y2={BARS_HEIGHT + 0.5}
      />
      {values.map(({ name, value }, index) => {
        const height = Math.round((value / high) * (BARS_HEIGHT - 2) * 10) / 10;
        return (
          <g key={name}>
            <title>{`${name}: ${String(value)}`}</title>
            {/* The whole column answers the pointer, so an empty day can be read too. */}
            <rect className="bar-hit" x={index * slot} y="0" width={slot} height={BARS_HEIGHT} />
            {value > 0 && (
              <rect
                className="bar-day"
                x={Math.round((index * slot + BAR_GAP / 2) * 10) / 10}
                y={BARS_HEIGHT - height}
                width={Math.round((slot - BAR_GAP) * 10) / 10}
                height={height}
                rx="2"
              />
            )}
          </g>
        );
      })}
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

function at(value: number): string {
  return `${String(Math.round(Math.min(Math.max(value, 0), 1) * 1000) / 10)}%`;
}

/** A score on a 0 to 100% track: its likely range shaded, the score as a dot, and the target as
 * a tick. Decorative: the figures are written beside it. */
export function RangeBar({
  value,
  range,
  target,
}: {
  value: number;
  range: [number, number] | null;
  target?: number;
}) {
  return (
    <svg className="rangebar" height="14" aria-hidden="true" focusable="false">
      <rect className="bar-track" y="5" width="100%" height="4" rx="2" />
      {range && (
        <rect
          className="range-band"
          x={at(range[0])}
          y="3"
          width={at(range[1] - range[0])}
          height="8"
          rx="4"
        />
      )}
      {target !== undefined && (
        <line className="range-target" x1={at(target)} x2={at(target)} y1="0" y2="14" />
      )}
      <circle className="range-dot" cx={at(value)} cy="7" r="4" />
    </svg>
  );
}

const VC_WIDTH = 320;
const VC_HEIGHT = 150;
const VC_TOP = 14;
const VC_BOTTOM = 22;

/** One point a version, oldest first: its exam score as a dot, its likely range as a whisker,
 * and the target as a dashed line. */
export function VersionChart({
  points,
  target,
  label,
}: {
  points: { name: string; value: number; range: [number, number] | null }[];
  target?: number;
  label: string;
}) {
  if (points.length === 0) return null;
  const plot = VC_HEIGHT - VC_TOP - VC_BOTTOM;
  const y = (value: number) => Math.round((VC_TOP + (1 - value) * plot) * 10) / 10;
  const slot = VC_WIDTH / points.length;
  return (
    <svg
      className="versionchart"
      viewBox={`0 0 ${String(VC_WIDTH)} ${String(VC_HEIGHT)}`}
      role="img"
      aria-label={label}
    >
      <line className="vc-axis" x1="0" x2={VC_WIDTH} y1={y(0)} y2={y(0)} />
      {target !== undefined && (
        <g>
          <line
            className="range-target vc-target"
            x1="0"
            x2={VC_WIDTH}
            y1={y(target)}
            y2={y(target)}
          />
        </g>
      )}
      {points.map(({ name, value, range }, index) => {
        const x = Math.round((index + 0.5) * slot * 10) / 10;
        return (
          <g key={name}>
            <title>{`${name}: ${String(Math.round(value * 100))}%`}</title>
            {range && (
              <line className="vc-whisker" x1={x} x2={x} y1={y(range[1])} y2={y(range[0])} />
            )}
            <circle className="range-dot" cx={x} cy={y(value)} r="4.5" />
            <text className="vc-value" x={x + 8} y={y(value) + 4}>
              {Math.round(value * 100)}%
            </text>
            <text className="vc-name" x={x} y={VC_HEIGHT - 6} textAnchor="middle">
              {name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
