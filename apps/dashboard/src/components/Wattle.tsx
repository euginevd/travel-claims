import { ArrowLeft } from "lucide-react";
import { useId, type Ref } from "react";

// The dashboard's Wattle AI panel is the Copilot, with its sign-off cards; this file holds the
// shared mark, header button, project link and footer.

/** Wattle AI's mark: a wattle sprig with coral blossoms on ink, the same in every UnderCover
    app. The blossoms swell in turn only while Wattle is working. */
export function WattleMark({ size = 20, working = false }: { size?: number; working?: boolean }) {
  const id = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`wattle-mark${working ? " working" : ""}`}
    >
      <defs>
        <radialGradient id={`${id}-ink`} cx="0.3" cy="0" r="1.1">
          <stop offset="0" stopColor="#4a4844" />
          <stop offset="0.5" stopColor="#262522" />
          <stop offset="1" stopColor="#171614" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="12" fill={`url(#${id}-ink)`} />
      <path
        d="M6.2 18.6 C8.6 14 12.4 10.2 18.4 6.4"
        fill="none"
        stroke="#f4f3f0"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M9.3 14.2 L7.6 11.6 M12.2 11.1 L14.6 13.4 M14.9 8.9 L13.6 6.4"
        fill="none"
        stroke="#f4f3f0"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <g fill="#ec8a70">
        <circle className="b b1" cx="7.1" cy="10.6" r="2.3" />
        <circle className="b b2" cx="15.4" cy="14.3" r="2" />
        <circle className="b b3" cx="13.2" cy="5.5" r="1.7" />
        <circle className="b b4" cx="18.6" cy="6.3" r="1.2" />
      </g>
    </svg>
  );
}

export const COPILOT_PANEL_ID = "copilot-panel";

/** The header button that opens and closes Wattle AI's panel. */
export function WattleButton({
  onClick,
  open,
  ref,
}: {
  onClick: () => void;
  open: boolean;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      className="wattle-pill"
      aria-label="Ask Wattle AI"
      aria-expanded={open}
      aria-controls={COPILOT_PANEL_ID}
      onClick={onClick}
    >
      <WattleMark size={20} />
      <span className="wattle-pill-label">Ask Wattle</span>
      <span className="wattle-ai-tag">AI</span>
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
    <a className="project-link" href={PROJECT_URL} aria-label="Project">
      <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
      <span>Project</span>
    </a>
  );
}

export const WATTLE_FOOTER =
  "AI powered · cites its sources · a claims expert makes the final call";
