import { useEffect, useState } from "react";
import { WattleMark } from "./Wattle";

// The sign-in page's decorative loop: a sample claim is checked, its sources appear, the agent
// recommends, and a senior handler signs it off. It's aria-hidden, and with reduced motion (or
// no matchMedia, as in tests) it shows the signed-off moment and stays still. The claim is an
// example, labelled as one, not live data.

interface Frame {
  title: string;
  detail: string;
  pill: string;
  tone: "" | "warn" | "good";
  say: string;
}

export const FRAMES: Frame[] = [
  {
    title: "Agent is reading the claim",
    detail: "Policy, airline report and receipts",
    pill: "Checking",
    tone: "",
    say: "Agent checking CLM-1011",
  },
  {
    title: "Agent is reading the claim",
    detail: "Policy, airline report and receipts",
    pill: "Checking",
    tone: "",
    say: "Sources attached to every check",
  },
  {
    title: "Recommends approve $1,150",
    detail: "Item limits applied, less the excess",
    pill: "Needs sign-off",
    tone: "warn",
    say: "Over the limit, so a senior handler signs off",
  },
  {
    title: "Recommends approve $1,150",
    detail: "Item limits applied, less the excess",
    pill: "Approved",
    tone: "good",
    say: "Signed off and paid",
  },
];

const LAST = FRAMES.length - 1;
const START_MS = 900;
const FRAME_MS = 2400;

export function prefersStill(): boolean {
  return (
    typeof window.matchMedia !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function SignInScene() {
  const [at, setAt] = useState(() => (prefersStill() ? LAST : 0));

  useEffect(() => {
    if (prefersStill()) return;
    let loop: number | undefined;
    const start = window.setTimeout(() => {
      loop = window.setInterval(() => {
        setAt((now) => (now + 1) % FRAMES.length);
      }, FRAME_MS);
    }, START_MS);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(loop);
    };
  }, []);

  const frame = FRAMES[at] ?? FRAMES[LAST];
  if (!frame) return null;
  return (
    <div className="signin-scenewrap" aria-hidden="true">
      <div className="scene">
        <div className="glass scene-chip">Sample claim</div>
        <div className="scene-card scene-back-2" />
        <div className="scene-card scene-back-1" />
        <div className="scene-card scene-front">
          <div className="scene-head">
            <div>
              <p className="scene-id">CLM-1011 · Owen Gallagher · Premium</p>
              <p className="scene-title">Best man&apos;s suitcase lost on the way to a wedding</p>
            </div>
            <span className="scene-amount">$1,950</span>
          </div>
          <div className="scene-rec">
            <WattleMark size={26} />
            <div key={frame.title} className="scene-rec-text">
              <b>{frame.title}</b>
              <small>{frame.detail}</small>
            </div>
            <span className={`scene-pill ${frame.tone}`}>{frame.pill}</span>
          </div>
          <div className={`scene-sources${at >= 1 ? " on" : ""}`}>
            <span>Policy wording</span>
            <span>Airline report</span>
            <span>Receipts</span>
          </div>
          <p className={`scene-signed${at === LAST ? " on" : ""}`}>
            <span className="scene-avatar">DW</span>
            Signed off by Dana Whitfield, senior handler
          </p>
        </div>
      </div>
      <p className="signin-wattle">
        <WattleMark size={22} />
        <span key={frame.say} className="signin-say">
          {frame.say}
        </span>
        <span className="typing">
          <i />
          <i />
          <i />
        </span>
      </p>
    </div>
  );
}
