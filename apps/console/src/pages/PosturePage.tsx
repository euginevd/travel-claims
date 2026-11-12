import {
  Boxes,
  CircleAlert,
  Info,
  LoaderCircle,
  Radar,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestionMark,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Api, Posture, Severity } from "../api";
import { TableScroll } from "../components/TableScroll";
import { dollars, when } from "../format";
import { useFocusHeading } from "../useFocusHeading";
import { AGENTS_HREF, COVERAGE_HREF, DETECTIONS_HREF, REDTEAM_HREF } from "../useHashRoute";

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

const DETECTION_LABELS = {
  hidden_instruction: "Hidden-instruction check",
  guardrail: "Bedrock guardrail",
  refusal: "Model refused",
  held: "Payout held",
} as const;

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

function Stage({
  step,
  icon,
  title,
  value,
  unit,
  children,
  link,
}: {
  step: number;
  icon: ReactNode;
  title: string;
  value: string;
  unit: string;
  children: ReactNode;
  link?: { href: string; label: string };
}) {
  return (
    <li className="kpi stage">
      <p className="stage-title">
        <span className="icon-tile" aria-hidden="true">
          {icon}
        </span>
        {title}
        <span className="stage-step" aria-hidden="true">
          {step}
        </span>
      </p>
      <p className="kpi-value">{value}</p>
      <p className="kpi-sub">{unit}</p>
      <dl className="stage-rows">{children}</dl>
      {link && (
        <a className="stage-link small" href={link.href}>
          {link.label}
        </a>
      )}
    </li>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function YesNo({ yes, words }: { yes: boolean; words: [string, string] }) {
  return yes ? (
    <span className="chip chip-good">
      <ShieldCheck size={13} strokeWidth={1.75} aria-hidden="true" />
      {words[0]}
    </span>
  ) : (
    <span className="chip chip-warn">
      <CircleAlert size={13} strokeWidth={1.75} aria-hidden="true" />
      {words[1]}
    </span>
  );
}

/** Four cards, left to right: what runs, how it's controlled, what's open, what fired. */
function Stages({ posture }: { posture: Posture }) {
  const { inventory, controls, issues, detections, readiness } = posture;
  const bySeverity = (severity: Severity) => issues.filter((i) => i.severity === severity).length;
  const fired = Object.values(detections).reduce((sum, count) => sum + count, 0);
  return (
    <ul className="kpis stages" aria-label="Security at a glance">
      <Stage
        step={1}
        icon={<Boxes size={16} strokeWidth={1.75} />}
        title="What we run"
        value={String(inventory.agents)}
        unit="AI agents"
        link={{ href: AGENTS_HREF, label: "What each could do if tricked" }}
      >
        <Row label="Claude models">{inventory.models}</Row>
        <Row label="Risks catalogued">{inventory.risks}</Row>
        <Row label="Claim agent version">
          {inventory.live_version === null ? "–" : `v${String(inventory.live_version)}`}
        </Row>
      </Stage>
      <Stage
        step={2}
        icon={<SlidersHorizontal size={16} strokeWidth={1.75} />}
        title="Controls"
        value={`${String(controls.tested)} of ${String(controls.risks)}`}
        unit="risks tested by an attack"
        link={{ href: COVERAGE_HREF, label: "Each risk and its control" }}
      >
        <Row label="Risks with a control">
          {controls.with_control} of {controls.risks}
        </Row>
        <Row label="OWASP LLM Top 10">
          {controls.llm_tested} of {controls.llm_total} tested
        </Row>
        <Row label="OWASP agentic">
          {controls.agentic_tested} of {controls.agentic_total} tested
        </Row>
      </Stage>
      <Stage
        step={3}
        icon={<ShieldAlert size={16} strokeWidth={1.75} />}
        title="Gaps"
        value={String(issues.length)}
        unit="to close, listed below"
      >
        {(["high", "medium", "low"] as const).map((severity) => (
          <Row key={severity} label={SEVERITY[severity].label}>
            {bySeverity(severity)}
          </Row>
        ))}
      </Stage>
      <Stage
        step={4}
        icon={<Radar size={16} strokeWidth={1.75} />}
        title="Detections"
        value={String(fired)}
        unit={`on live claims, last ${String(posture.detection_days)} days`}
        link={{ href: DETECTIONS_HREF, label: "Every detection" }}
      >
        {(Object.keys(DETECTION_LABELS) as (keyof typeof DETECTION_LABELS)[]).map((kind) => (
          <Row key={kind} label={DETECTION_LABELS[kind]}>
            {detections[kind]}
          </Row>
        ))}
        <Row label="Payouts">
          <YesNo yes={!readiness.payouts_paused} words={["On", "Paused"]} />
        </Row>
        <Row label="Version in use red-teamed">
          <YesNo yes={readiness.live_version_red_teamed} words={["Yes", "No"]} />
        </Row>
      </Stage>
    </ul>
  );
}

/** Each layer an attack meets, with how many of the latest run's attacks reached it and how many
 * it stopped. A layer no attack reached is marked untested. */
function Layers({ posture }: { posture: Posture }) {
  const run = posture.redteam;
  if (!run) {
    return (
      <div className="panel empty">
        <span className="icon-tile" aria-hidden="true">
          <ShieldQuestionMark size={19} strokeWidth={1.75} />
        </span>
        <h2>No red-team run yet</h2>
        <p className="muted">
          Run the red team to see which layer stops each attack.{" "}
          <a href={REDTEAM_HREF}>Go to the red team</a>
        </p>
      </div>
    );
  }
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
        <p className="panel-note">Worked out from the red team and the threat catalogue</p>
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
                <th scope="col">Where</th>
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
                    <td className="nowrap">
                      {issue.link === "redteam" ? (
                        <a href={REDTEAM_HREF}>Red team</a>
                      ) : (
                        <a href={COVERAGE_HREF}>Coverage</a>
                      )}
                    </td>
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
    <section className="view" aria-labelledby="posture-heading">
      <header className="page-head">
        <div>
          <p className="eyebrow">Security · Posture</p>
          <h1 id="posture-heading" ref={heading} tabIndex={-1}>
            Would we stop an attack?
          </h1>
          <p className="lede">
            Worked out in code from the latest red-team run, the threat catalogue and the controls
            that fired on live claims.
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
          <Stages posture={posture} />
          <Layers posture={posture} />
          <Gaps posture={posture} />
        </>
      )}
    </section>
  );
}
