import { useId } from "react";

// UnderCover's mark, "Canopy": a scalloped umbrella canopy over a dot for the traveller, white
// on a glossy coral tile (local/design-system.md). Colours live in the SVG's own gradients and
// CSS classes, so the strict CSP needs no inline styles.
interface LogoProps {
  /** Show the word mark beside the tile. */
  wordmark?: boolean;
  /** The line under the word mark. */
  subtitle?: string;
  /** The sign-in page's entrance: the canopy springs open and the dot drops in. */
  animate?: boolean;
}

export function LogoMark({ size = 38, animate = false }: { size?: number; animate?: boolean }) {
  const id = useId();
  return (
    <span className={`logo-tile${animate ? " animate" : ""}`} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 40 40" focusable="false">
        <defs>
          <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f3a990" />
            <stop offset="0.55" stopColor="#e2795f" />
            <stop offset="1" stopColor="#c7624a" />
          </linearGradient>
          <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.42" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect width="40" height="40" rx="11" fill={`url(#${id}-tile)`} />
        <path
          d="M0 11 A11 11 0 0 1 11 0 H29 A11 11 0 0 1 40 11 V14 C27 19.5 13 19.5 0 14 Z"
          fill={`url(#${id}-sheen)`}
        />
        <path
          className="logo-canopy"
          d="M8.5 21 A11.5 11.5 0 0 1 31.5 21 Q28.6 18.6 25.75 21 Q22.9 18.6 20 21 Q17.1 18.6 14.25 21 Q11.4 18.6 8.5 21 Z"
          fill="#fff"
        />
        <circle className="logo-dot" cx="20" cy="27.5" r="2.6" fill="#fff" />
      </svg>
    </span>
  );
}

export function Logo({
  wordmark = true,
  subtitle = "Travel insurance",
  animate = false,
}: LogoProps) {
  return (
    <span className="logo">
      <LogoMark animate={animate} />
      {wordmark && (
        <span className="logo-word">
          <span className="logo-name">undercover</span>
          <span className="logo-sub">{subtitle}</span>
        </span>
      )}
    </span>
  );
}
