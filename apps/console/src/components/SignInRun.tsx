import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { WattleMark } from "./Wattle";

// The sign-in page's decorative loop: an evaluation run fills in claim by claim, its measures
// follow, then the red team's chips arrive. It's an illustration with example figures (nothing
// is loaded before sign-in) and aria-hidden. With reduced motion (or no matchMedia, as in
// tests) it shows the finished run and stays still.

const CLAIMS = 25;
// The claims drawn as "sent to a person".
const REFERRED = new Set([3, 9, 14, 18, 22]);
const ATTACKS = [
  ["LLM01", "Injection"],
  ["LLM02", "Data leak"],
  ["LLM06", "Excessive agency"],
] as const;

const TICK_MS = 180;
// The loop in ticks: a pause, 25 claims, then the red team's chips one by one, then a rest.
const START = 5;
const CHIPS_AT = [START + CLAIMS + 2, START + CLAIMS + 6, START + CLAIMS + 9];
const HELD_AT = START + CLAIMS + 13;
const LOOP = 56;
const FINISHED = LOOP - 1;

export function prefersStill(): boolean {
  return (
    typeof window.matchMedia !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface Frame {
  done: number;
  straightThrough: string;
  cost: string;
  chips: number;
  say: string;
}

/** What the card shows at one tick of the loop. */
export function frameAt(tick: number): Frame {
  const done = Math.min(Math.max(tick - START, 0), CLAIMS);
  let decided = 0;
  for (let index = 0; index < done; index++) if (!REFERRED.has(index)) decided += 1;
  const chips = CHIPS_AT.filter((at) => tick >= at).length;
  return {
    done,
    straightThrough: done ? `${String(Math.round((decided / done) * 100))}%` : "–",
    cost: done ? (done === CLAIMS || done % 3 === 0 ? "$0.04" : "$0.03") : "–",
    chips,
    say:
      tick >= HELD_AT
        ? "All attacks held. Changes still need approval"
        : done === CLAIMS
          ? "Running the red team"
          : done >= 8
            ? "Every decision traced end to end"
            : "Scoring the agent against handler decisions",
  };
}

export function SignInRun() {
  const [tick, setTick] = useState(() => (prefersStill() ? FINISHED : 0));

  useEffect(() => {
    if (prefersStill()) return;
    const timer = window.setInterval(() => {
      setTick((now) => (now + 1) % LOOP);
    }, TICK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const frame = frameAt(tick);
  return (
    <div aria-hidden="true">
      <div className="signin-vis">
        <span className="glass run-live">
          <span className="live-dot" />
          Run 4 in progress
        </span>
        <div className="run-card">
          <div className="run-card-head">
            <b>Evaluation run 4 · held-out set</b>
            <span>
              {frame.done} of {CLAIMS} claims
            </span>
          </div>
          <div>
            <div className="run-dots">
              {Array.from({ length: CLAIMS }, (_, index) => (
                <i
                  key={index}
                  className={index < frame.done ? (REFERRED.has(index) ? "ref" : "ok") : undefined}
                />
              ))}
            </div>
            <div className="run-legend">
              <span>Agent decided</span>
              <span className="ref">Sent to a person</span>
            </div>
          </div>
          <div className="run-kpis">
            <div className="run-kpi">
              <small>Accuracy</small>
              <b>{frame.done ? "100%" : "–"}</b>
            </div>
            <div className="run-kpi">
              <small>Straight through</small>
              <b>{frame.straightThrough}</b>
            </div>
            <div className="run-kpi">
              <small>Cost per claim</small>
              <b>{frame.cost}</b>
            </div>
          </div>
          <div className="run-redteam">
            {ATTACKS.map(([id, name], index) => (
              <span key={id} className={`run-chip${index < frame.chips ? " on" : ""}`}>
                <em>{id}</em>
                {name}
                <Check size={11} strokeWidth={3} />
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="signin-wattle">
        <WattleMark size={24} />
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
