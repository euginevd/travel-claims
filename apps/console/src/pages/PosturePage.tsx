import {
  CircleAlert,
  Info,
  LoaderCircle,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestionMark,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Api, Posture, Severity } from "../api";
import { RisksTable } from "../components/RisksTable";
import { TableScroll } from "../components/TableScroll";
import { dollars, when } from "../format";
import { useFocusHeading } from "@undercover/web-core/useFocusHeading";
import { DETECTIONS_HREF, REDTEAM_HREF } from "../useHashRoute";

const SEVERITY: Record<Severity, { label: string; chip: string; icon: ReactNode }> = {
  high: {
    label: "High",
    chip: "chip chip-bad",
    icon: <ShieldAlert size={13} strokeWidth={1.75} aria-hidden="true" />,
  },
  medium: {
    label: "Medium",
    chip: "chip chip-warn",
    icon: <TriangleAlert size={13} strokeWidth={1.75} aria-hidden="true" />,
  },
  low: {
    label: "Low",
    chip: "chip",
    icon: <Info size={13} strokeWidth={1.75} aria-hidden="true" />,
  },
};

function plural(count: number, one: string, many = `${one}s`): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** The answer to the page's question, in one line, from the api's verdict. */
function Verdict({ posture }: { posture: Posture }) {
  const run = posture.redteam;
  const words = {
    untested: {
      title: "No attacks run yet",
      text: "The red team hasn't run, so no layer has faced an attack.",
    },
    failing: {
      title: "An attack got money out",
      text: run
        ? `${String(run.held)} of ${String(run.attacks)} attacks were stopped and ${dollars(run.paid)} was paid. Fix the failed attack first.`
        : "",
    },
    gap: {
      title: "Every attack was stopped, but parts are untested",
      text: run
        ? `${String(run.held)} of ${String(run.attacks)} attacks were stopped and ${dollars(run.paid)} was paid, but the gaps below have never faced an attack.`
        : "",
    },
    holding: {
      title: "Every attack was stopped",
      text: run
        ? `${String(run.held)} of ${String(run.attacks)} attacks were stopped and ${dollars(run.paid)} was paid.`
        : "",
    },
  }[posture.verdict];
  const good = posture.verdict === "holding";
  return (
    <div className={`panel verdict${good ? " wash-sage" : " alert"}`}>
      <div className="verdict-text">
        <p className="verdict-title">
          {good ? (
            <ShieldCheck size={24} strokeWidth={1.75} aria-hidden="true" />
          ) : posture.verdict === "untested" ? (
            <ShieldQuestionMark size={24} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <ShieldAlert size={24} strokeWidth={1.75} aria-hidden="true" />
          )}
          <strong>{words.title}</strong>
        </p>
        <p className="muted">
          {words.text}
          {run &&
            ` Latest red-team run ${when(run.run_at)}, by ${run.run_by}${
              run.config_version === null ? "" : `, against version ${String(run.config_version)}`
            }.`}
        </p>
      </div>
    </div>
  );
}

/** One tile: a figure, what it's out of, and where to see more. */
function Tile({
  label,
  value,
  sub,
  link,
  children,
}: {
  label: string;
  value: ReactNode;
  sub: string;
  link?: { href: string; label: string };
  children?: ReactNode;
}) {
  return (
    <li className="kpi">
      <p className="kpi-label">{label}</p>
      <p className="kpi-value">{value}</p>
      <p className="kpi-sub">{sub}</p>
      {children}
      {link && (
        <a className="stage-link small" href={link.href}>
          {link.label}
        </a>
      )}
    </li>
  );
}

/** Four figures: the attacks stopped, the risks tested, what fired live and the payouts
 * switch. The rest of the page says where and what to close. */
function Tiles({ posture }: { posture: Posture }) {
  const { controls, detections, readiness, redteam } = posture;
  const fired = Object.values(detections).reduce((sum, count) => sum + count, 0);
  return (
    <ul className="kpis" aria-label="Security at a glance">
      <Tile
        label="Attacks stopped"
        value={redteam ? `${String(redteam.held)} of ${String(redteam.attacks)}` : "–"}
        sub={redteam ? `${dollars(redteam.paid)} paid, latest red-team run` : "Not run yet"}
        link={{ href: REDTEAM_HREF, label: "The attacks" }}
      />
      <Tile
        label="Risks tested by an attack"
        value={`${String(controls.tested)} of ${String(controls.risks)}`}
        sub={`OWASP LLM ${String(controls.llm_tested)} of ${String(controls.llm_total)}, agentic ${String(controls.agentic_tested)} of ${String(controls.agentic_total)}; each below`}
      />
      <Tile
        label="Fired on live claims"
        value={String(fired)}
        sub={`Last ${String(posture.detection_days)} days`}
        link={{ href: DETECTIONS_HREF, label: "Every detection" }}
      />
      <Tile
        label="Payouts switch"
        value={readiness.payouts_paused ? "Paused" : "On"}
        sub="Senior handlers own it; read-only here"
      >
        {readiness.payouts_paused && (
          <span className="chip chip-warn">
            <CircleAlert size={13} strokeWidth={1.75} aria-hidden="true" />
            No payouts are being made
          </span>
        )}
      </Tile>
    </ul>
  );
}

/** Each layer an attack meets, with how many of the latest run's attacks reached it and how many
 * it stopped. A layer no attack reached is marked untested. */
function Layers({ posture }: { posture: Posture }) {
  const run = posture.redteam;
  // The verdict above already says no run; no second empty box.
  if (!run) return null;
  const through = run.attacks - run.held;
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Defence in depth</h2>
        <p className="panel-note">
          Where the latest run&apos;s {plural(run.attacks, "attack")} were stopped
        </p>
      </div>
      <ol className="layers">
        {posture.layers.map((layer, index) => {
          const untested = layer.reached === 0;
          return (
            <li key={layer.key} className={untested ? "layer untested" : "layer"}>
              <span className="layer-step">Layer {index + 1}</span>
              <h3>{layer.name}</h3>
              <p className="small muted">{layer.what}</p>
              <ul className="layer-meter" aria-hidden="true">
                {Array.from({ length: run.attacks }, (_, at) => (
                  <li
                    key={at}
                    className={
                      at < layer.stopped ? "stopped" : at < layer.reached ? "passed" : undefined
                    }
                  />
                ))}
              </ul>
              {untested ? (
                <span className="chip chip-warn">
                  <CircleAlert size={13} strokeWidth={1.75} aria-hidden="true" />
                  Untested: no attack reached it
                </span>
              ) : (
                <p className="layer-result">
                  Reached by {layer.reached} · stopped {layer.stopped}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {through > 0 && (
        <p className="error" role="status">
          {plural(through, "attack")} got through every layer.{" "}
          <a href={REDTEAM_HREF}>See the red-team report</a>
        </p>
      )}
    </div>
  );
}

function Gaps({ posture }: { posture: Posture }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Gaps to close</h2>
        <p className="panel-note">
          Worked out from the red team and the threat catalogue. Most urgent first
        </p>
      </div>
      {posture.issues.length === 0 ? (
        <p className="muted small">No gaps: every risk is tested and every attack was stopped.</p>
      ) : (
        <TableScroll label="Gaps table">
          <table className="table min-mid">
            <thead>
              <tr>
                <th scope="col">Severity</th>
                <th scope="col">Gap</th>
              </tr>
            </thead>
            <tbody>
              {posture.issues.map((issue) => {
                const severity = SEVERITY[issue.severity];
                return (
                  <tr key={issue.title}>
                    <td>
                      <span className={severity.chip}>
                        {severity.icon}
                        {severity.label}
                      </span>
                    </td>
                    <th scope="row" className="prose">
                      {issue.title}
                      <span className="sub">{issue.detail}</span>
                    </th>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}
    </div>
  );
}

/** The console's home for an AI security engineer: would an attack be stopped, and where. */
export function PosturePage({ api }: { api: Api }) {
  const heading = useFocusHeading();
  const [posture, setPosture] = useState<Posture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const load = useCallback(() => {
    setError(null);
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    let live = true;
    api.getPosture().then(
      (found) => {
        if (live) setPosture(found);
      },
      (caught: unknown) => {
        if (live) setError(caught instanceof Error ? caught.message : String(caught));
      },
    );
    return () => {
      live = false;
    };
  }, [api, generation]);

  return (
    <section className="view fit" aria-labelledby="posture-heading">
      <header className="page-head">
        <div>
          <p className="eyebrow">Secure · Posture</p>
          <h1 id="posture-heading" ref={heading} tabIndex={-1}>
            Would we stop an attack?
          </h1>
          <p className="lede">
            Worked out in code from the latest red-team run, the OWASP risks and what fired on live
            claims.
          </p>
        </div>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
          <button type="button" className="button secondary" onClick={load}>
            Try again
          </button>
        </p>
      )}
      {!posture && !error && (
        <p role="status" className="loading">
          <LoaderCircle className="spin" size={16} strokeWidth={1.75} aria-hidden="true" />
          Loading the security posture…
        </p>
      )}
      {posture && (
        <>
          <Verdict posture={posture} />
          <Tiles posture={posture} />
          <Layers posture={posture} />
          <Gaps posture={posture} />
          <RisksTable api={api} />
        </>
      )}
    </section>
  );
}
