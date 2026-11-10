import { ArrowLeft } from "lucide-react";
import { useId } from "react";

// The dashboard's Wattle AI panel is the Copilot, with its sign-off cards; this file holds the
// shared mark, header button, project link and footer.

/** Wattle AI's mark: a golden wattle puff on green, the same in every UnderCover app. */
export function WattleMark({ size = 20 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="wattle-mark">
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffc93c" />
          <stop offset="1" stopColor="#2f7d4a" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill={`url(#${id}-g)`} />
      <g fill="#fff6c9">
        <circle cx="16" cy="11" r="3.4" />
        <circle cx="11" cy="17" r="3" />
        <circle cx="21" cy="17" r="3" />
        <circle cx="16" cy="21.5" r="2.6" />
      </g>
      <path d="M24.5 5.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" fill="#fff" />
    </svg>
  );
}

/** The header button that opens Wattle AI. */
export function WattleButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="wattle-pill" onClick={onClick}>
      <WattleMark size={18} />
      Wattle AI
    </button>
  );
}

const PROJECT_URL: string =
  // `||`, not `??`: the images build passes an empty string when it's unset.
  import.meta.env.VITE_PROJECT_URL ||
  `${window.location.protocol}//${window.location.hostname}:5172/`;

/** Back to the UnderCover project page. */
export function ProjectLink() {
  return (
    <a className="project-link" href={PROJECT_URL}>
      <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
      Project
    </a>
  );
}

export const WATTLE_FOOTER =
  "AI powered · cites its sources · a claims expert makes the final call";
