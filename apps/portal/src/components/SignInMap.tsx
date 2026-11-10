import { Check, CircleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { WattleMark } from "./Wattle";

// The sign-in page's decorative loop: a plane flies Sydney to Colombo, a delay is spotted and
// paid, then it flies on to London. It's aria-hidden, and with reduced motion (or no
// matchMedia, as in tests) it shows the "Paid" moment and stays still.

type Point = [number, number];
const SYDNEY: Point = [685, 400];
const COLOMBO: Point = [400, 236];
const LONDON: Point = [78, 58];
const ROUTE = "M685 400 Q560 262 400 236 Q232 120 78 58";

function bezier(a: Point, c: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return [
    u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
    u * u * a[1] + 2 * u * t * c[1] + t * t * b[1],
  ];
}

interface Sample {
  x: number;
  y: number;
  at: number; // distance along the route, 0 to 1
}

// The route sampled once, so the plane moves at an even speed along it.
function sampleRoute(): { samples: Sample[]; colombo: number } {
  const points: Point[] = [];
  const steps = 120;
  for (let i = 0; i <= steps; i++) points.push(bezier(SYDNEY, [560, 262], COLOMBO, i / steps));
  for (let i = 1; i <= steps; i++) points.push(bezier(COLOMBO, [232, 120], LONDON, i / steps));
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1] ?? [0, 0];
    const [x1, y1] = points[i] ?? [0, 0];
    lengths.push((lengths[i - 1] ?? 0) + Math.hypot(x1 - x0, y1 - y0));
  }
  const total = lengths[lengths.length - 1] ?? 1;
  const samples = points.map(([x, y], i) => ({ x, y, at: (lengths[i] ?? 0) / total }));
  return { samples, colombo: samples[steps]?.at ?? 0.5 };
}

const { samples: SAMPLES, colombo: AT_COLOMBO } = sampleRoute();

function placeAt(at: number): string {
  const last = SAMPLES.length - 1;
  const found = SAMPLES.findIndex((sample) => sample.at >= at);
  const index = found === -1 ? last : found;
  const here = SAMPLES[index];
  // The heading comes from this point and the next, or the one before at the very end.
  const from = SAMPLES[index === last ? index - 1 : index];
  const to = SAMPLES[index === last ? index : index + 1];
  if (!here || !from || !to) return "";
  const angle = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  return `translate(${here.x.toFixed(1)} ${here.y.toFixed(1)}) rotate(${angle.toFixed(1)})`;
}

export type Phase = "watching" | "spotted" | "paid" | "onward";

export const SAYS: Record<Phase, string> = {
  watching: "Watching your flights",
  spotted: "Delay spotted. Checking your cover",
  paid: "Paid to your PayID",
  onward: "Back on your way",
};

const FLY_OUT = 3200;
const HOLD = 4200;
const SPOTTED = 1900;
const FLY_ON = 3000;
const REST = 1400;
const LOOP = FLY_OUT + HOLD + FLY_ON + REST;

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export function prefersStill(): boolean {
  return (
    typeof window.matchMedia !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function SignInMap() {
  const [phase, setPhase] = useState<Phase>("paid");
  const plane = useRef<SVGGElement>(null);
  const trail = useRef<SVGPathElement>(null);

  useEffect(() => {
    const show = (at: number) => {
      plane.current?.setAttribute("transform", placeAt(at));
      trail.current?.setAttribute("stroke-dashoffset", String(1 - at));
    };
    show(AT_COLOMBO);
    if (prefersStill()) return;
    let frame = 0;
    const start = performance.now() + 1200;
    const tick = (now: number) => {
      const t = Math.max(0, now - start) % LOOP;
      if (now < start || t < FLY_OUT) {
        show(AT_COLOMBO * ease(now < start ? 0 : t / FLY_OUT));
        setPhase("watching");
      } else if (t < FLY_OUT + HOLD) {
        show(AT_COLOMBO);
        setPhase(t - FLY_OUT < SPOTTED ? "spotted" : "paid");
      } else if (t < FLY_OUT + HOLD + FLY_ON) {
        show(AT_COLOMBO + (1 - AT_COLOMBO) * ease((t - FLY_OUT - HOLD) / FLY_ON));
        setPhase("onward");
      } else {
        show(1);
        setPhase("onward");
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, []);

  const atColombo = phase === "spotted" || phase === "paid";
  return (
    <div className="signin-mapwrap" aria-hidden="true">
      <div className="signin-map">
        <img className="signin-land" src="/world-dots.svg" alt="" />
        <svg className="signin-route" viewBox="0 0 760 448">
          <path className="route-line" d={ROUTE} />
          <path
            ref={trail}
            className="route-trail"
            d={ROUTE}
            pathLength={1}
            strokeDasharray="1"
            strokeDashoffset="1"
          />
          <g className="city">
            <circle cx={SYDNEY[0]} cy={SYDNEY[1]} r="4.5" />
            <text x="672" y="430" textAnchor="middle">
              Sydney
            </text>
          </g>
          {atColombo && <circle className="city-pulse" cx={COLOMBO[0]} cy={COLOMBO[1]} r="5" />}
          <g className={`city${atColombo ? " alert" : ""}`}>
            <circle cx={COLOMBO[0]} cy={COLOMBO[1]} r="4.5" />
            <text x="400" y="266" textAnchor="middle">
              Colombo
            </text>
          </g>
          <g className="city">
            <circle cx={LONDON[0]} cy={LONDON[1]} r="4.5" />
            <text x="78" y="36" textAnchor="middle">
              London
            </text>
          </g>
          <g ref={plane} className="plane">
            <path d="M10 0 L-8 -7 L-4 0 L-8 7 Z" />
          </g>
        </svg>
        <div
          className={`glass map-tag${atColombo ? " show" : ""}${phase === "paid" ? " paid" : ""}`}
        >
          <span className="map-tag-icon">
            {phase === "paid" ? (
              <Check size={13} strokeWidth={2.6} />
            ) : (
              <CircleAlert size={13} strokeWidth={2.4} />
            )}
          </span>
          {phase === "paid" ? (
            <span>
              <b>Paid $425</b> <span className="map-tag-meta">in 5 sec</span>
            </span>
          ) : (
            <span>
              <b>UL 503</b> <span className="map-tag-meta">4h 40m delay spotted</span>
            </span>
          )}
        </div>
        <div className="glass map-online">
          <span className="live-dot" />
          Claims team online
        </div>
      </div>
      <p className="signin-wattle">
        <WattleMark size={22} />
        <span key={phase} className="signin-say">
          {SAYS[phase]}
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
