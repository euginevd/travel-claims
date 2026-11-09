// UnderCover's mark: an umbrella sheltering a suitcase. Colours come from the design tokens
// through CSS classes, so the strict CSP needs no inline styles.
interface LogoProps {
  /** Show the word mark beside the symbol. */
  wordmark?: boolean;
  tone?: "on-ink" | "ink";
}

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      className="logo-mark"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="logo-disc" cx="24" cy="24" r="24" />
      <path
        className="logo-canopy"
        d="M8 23c1.6-8 8.3-13 16-13s14.4 5 16 13c-2.6-2.2-5.3-2.2-8 0-2.6-2.2-5.4-2.2-8 0-2.6-2.2-5.4-2.2-8 0-2.7-2.2-5.4-2.2-8 0z"
      />
      <path className="logo-stem" d="M24 23v4" strokeWidth="2.4" strokeLinecap="round" />
      <rect className="logo-case" x="15" y="28" width="18" height="12" rx="2.5" />
      <path
        className="logo-handle"
        d="M20.5 28v-2.2a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5V28"
        strokeWidth="2"
        fill="none"
      />
      <path className="logo-strap" d="M15 33.5h18" strokeWidth="1.6" />
    </svg>
  );
}

export function Logo({ wordmark = true, tone = "ink" }: LogoProps) {
  return (
    <span className={`logo logo-${tone}`}>
      <LogoMark />
      {wordmark && (
        <span className="logo-word">
          UnderCover <span className="logo-sub">Claims</span>
        </span>
      )}
    </span>
  );
}
