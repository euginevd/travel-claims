import { useId } from "react";

// UnderCover's mark, "Canopy": a scalloped umbrella canopy over a dot for the traveller, white
// on a coral tile (local/logo.svg). The tile's gradient stops live in the SVG; everything else
// comes from CSS classes, so the strict CSP needs no inline styles.
interface LogoProps {
  /** Show the word mark beside the tile. */
  wordmark?: boolean;
  /** The line under the word mark: the app it names. */
  subtitle: string;
  /** The sign-in page's entrance: the canopy springs open and the dot drops in. */
  animate?: boolean;
}

function LogoMark({ size = 38, animate = false }: { size?: number; animate?: boolean }) {
  const id = useId();
  return (
    <span className={`logo-tile${animate ? " animate" : ""}`} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 40 40" focusable="false">
        <defs>
          <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ea8d73" />
            <stop offset="1" stopColor="#d96a50" />
          </linearGradient>
          <radialGradient id={`${id}-glow`} cx=".3" cy="0" r=".75">
            <stop offset="0" stopColor="#fff" stopOpacity=".34" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="40" height="40" rx="11" fill={`url(#${id}-tile)`} />
        <rect width="40" height="40" rx="11" fill={`url(#${id}-glow)`} />
        <path
          className="logo-canopy"
          d="M8 21.5 A12 12 0 0 1 32 21.5 Q28 17.9 24 21.5 Q20 17.9 16 21.5 Q12 17.9 8 21.5 Z"
          fill="#fff"
        />
        <circle className="logo-dot" cx="20" cy="27.9" r="2.7" fill="#fff" />
      </svg>
    </span>
  );
}

export function Logo({ wordmark = true, subtitle, animate = false }: LogoProps) {
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
