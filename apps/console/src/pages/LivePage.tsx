import { Activity, CircleAlert, CircleCheck, LoaderCircle, Plus, ThumbsDown } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  LIVE_PERIODS,
  type Api,
  type Disagreement,
  type Live,
  type LivePeriod,
  type Slice,
} from "../api";
import { BarSeries, MiniBar, Sparkline } from "../components/Charts";
import { TableScroll } from "../components/TableScroll";
import { TrendsPanels } from "../components/TrendsPanels";
import { date, dollars, when } from "../format";
import { useFocusHeading } from "@undercover/web-core/useFocusHeading";
import { traceHref } from "../useHashRoute";

const DECISIONS: Record<string, string> = {
  approve: "Approve",
  decline: "Decline",
  refer: "Refer",
};
const REASONS: Record<string, string> = {
  policy_wording: "Policy wording",
  evidence: "Evidence",
  calculation: "Calculation",
  customer_circumstances: "Customer circumstances",
  suspected_fraud: "Suspected fraud",
  other: "Other",
};

// Where a tile turns amber: a prototype's rule of thumb, not a business setting.
const TARGETS = { straightThrough: 0.6, disagreement: 0.2, cost: 0.03 };
// How far live agreement may sit below the exam before it's called out.
const EXAM_GAP = 0.1;
// How many times the exam's cost per claim live may run before it's called out.
const COST_GAP = 1.5;

function percent(share: number | null): string {
  return share === null ? "–" : `${String(Math.round(share * 1000) / 10)}%`;
}

function decided(decision: string | null, payout: number | null): string {
  if (decision === null) return "–";
  const label = DECISIONS[decision] ?? decision;
  return decision === "approve" && payout !== null ? `${label} ${dollars(payout)}` : label;
}

function money(value: number | null): string {
  return value === null ? "–" : `$${value.toFixed(3)}`;
}

// Under this many claims a share can't be told from chance: it says so, never raises an alarm.
const FEWEST = 10;
const TOO_FEW = "Too few to judge";

/** The headline tiles: each a number with what it's out of written under it, and a word and
 * icon when it's past its target. */
function Tiles({ live }: { live: Live }) {
  const t = live.totals;
  const tiles: [label: string, value: string, sub: string, off: string | null][] = [
    ["Claims decided", String(t.decided), `Live claims, last ${String(live.days)} days`, null],
    [
      "Straight through",
      percent(t.straight_through_share),
      `${String(t.straight_through)} of ${String(t.decided)} decided and paid with no person`,
      t.straight_through_share === null
        ? null
        : t.decided < FEWEST
          ? TOO_FEW
          : t.straight_through_share < TARGETS.straightThrough
            ? `Below ${percent(TARGETS.straightThrough)}`
            : null,
    ],
    [
      "Cost per claim",
      money(t.cost_per_claim),
      t.seconds_per_claim === null
        ? "No timed decisions yet"
        : `${String(Math.round(t.seconds_per_claim))} s per claim on average`,
      t.cost_per_claim !== null && t.cost_per_claim > TARGETS.cost
        ? `Above ${money(TARGETS.cost)}`
        : null,
    ],
    [
      "Handler disagreement",
      percent(t.disagreement_rate),
      `${String(t.disagreements)} of ${String(t.reviewed)} reviewed decisions overridden or sent back`,
      t.disagreement_rate === null
        ? null
        : t.reviewed < FEWEST
          ? TOO_FEW
          : t.disagreement_rate > TARGETS.disagreement
            ? `Above ${percent(TARGETS.disagreement)}`
            : null,
    ],
    ["Referrals", String(t.referrals), "Decisions that went to a handler", null],
    [
      "Hidden-instruction flags",
      String(t.hidden_instruction_flags),
      "Claims the check stopped before the agent",
      null,
    ],
  ];
  return (
    <ul className="kpis six" aria-label="Live behaviour at a glance">
      {tiles.map(([label, value, sub, off]) => (
        <li key={label} className="kpi">
          <p className="kpi-label">{label}</p>
          <p className="kpi-value">{value}</p>
          <p className="kpi-sub">{sub}</p>
          {off === TOO_FEW ? (
            <span className="chip">{off}</span>
          ) : (
            off && (
              <span className="chip chip-warn">
                <CircleAlert size={13} strokeWidth={1.75} aria-hidden="true" />
                {off}
              </span>
            )
          )}
        </li>
      ))}
    </ul>
  );
}

/** The version in use's exam beside how it's doing live: a gap means the exam's claims don't
 * look like real ones. */
function ExamVsLive({ live }: { live: Live }) {
  const { exam } = live;
  const name = live.version === null ? null : `v${String(live.version)}`;
  // Only the version in use's own live claims: an older version's numbers say nothing about it.
  const own = live.by_version.find((row) => row.name === name) ?? null;
  const kept = own === null ? null : 1 - own.disagreements / own.decided;
  const warnings: string[] = [];
  if (exam !== null && own !== null) {
    if (kept !== null && exam.accuracy - kept > EXAM_GAP) {
      warnings.push(
        `Live is over ${percent(EXAM_GAP)} below the exam: add the disagreements below to the evaluation set`,
      );
    }
    if (own.cost_per_claim !== null && own.cost_per_claim > exam.cost_per_claim * COST_GAP) {
      warnings.push(
        `Live costs over ${String(COST_GAP)}× the exam: real claims may need more model calls`,
      );
    }
  }
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Exam against live{name !== null && ` · ${name} in use`}</h2>
        <p className="panel-note">
          Does the version in use do as well on real claims as on its exam?
        </p>
      </div>
      {exam === null ? (
        <p className="muted small">
          The version in use hasn&apos;t taken an exam yet. An improvement round gives it one.
        </p>
      ) : (
        <>
          <TableScroll label="Exam against live table">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Measure</th>
                  <th scope="col">Exam ({exam.claims} claims)</th>
                  <th scope="col">
                    Live ({own === null ? "none yet" : `${String(own.decided)} claims`})
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">
                    Right decision
                    <span className="sub">Live: decisions no handler overrode or sent back</span>
                  </th>
                  <td>{percent(exam.accuracy)}</td>
                  <td>{percent(kept)}</td>
                </tr>
                <tr>
                  <th scope="row">Cost per claim</th>
                  <td>{money(exam.cost_per_claim)}</td>
                  <td>{money(own?.cost_per_claim ?? null)}</td>
                </tr>
              </tbody>
            </table>
          </TableScroll>
          {own === null ? (
            <p className="muted small">
              {name} hasn&apos;t decided a live claim in the last {live.days} days, so there&apos;s
              nothing to compare yet.
            </p>
          ) : warnings.length > 0 ? (
            warnings.map((warning) => (
              <p key={warning} className="chip chip-warn">
                <CircleAlert size={13} strokeWidth={1.75} aria-hidden="true" />
                {warning}
              </p>
            ))
          ) : (
            <p className="chip chip-good">
              <CircleCheck size={13} strokeWidth={1.75} aria-hidden="true" />
              Live is in line with the exam
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** A breakdown's name as read: claims from before versions were recorded say so. */
function label(name: string): string {
  if (name === "Unknown") return "Before versions";
  return /^v\d/.test(name) ? name : name.charAt(0).toUpperCase() + name.slice(1);
}

/** One breakdown of the period's decisions: by agent version or by claim type. */
function SliceTable({
  title,
  column,
  rows,
  current,
}: {
  title: string;
  column: string;
  rows: Slice[];
  current?: string;
}) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="muted small">No decisions in this period.</p>
      ) : (
        <TableScroll label={`${title} table`}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{column}</th>
                <th scope="col">Decided</th>
                <th scope="col">Straight through</th>
                <th scope="col">Disagreed</th>
                <th scope="col">Cost per claim</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name}>
                  <th scope="row" className="nowrap">
                    {label(row.name)} {row.name === current && <span className="tag">In use</span>}
                    {current !== undefined && row.first_day && (
                      <span className="sub">from {date(row.first_day)}</span>
                    )}
                  </th>
                  <td>{row.decided}</td>
                  <td>{percent(row.straight_through_share)}</td>
                  <td>{row.disagreements}</td>
                  <td>{money(row.cost_per_claim)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </div>
  );
}

/** Two small charts, one measure each: how many were decided a day, and the share of each
 * day's decisions that went straight through. */
function Trends({ live }: { live: Live }) {
  const busy = live.series.filter((day) => day.decided > 0);
  const shares = busy.map((day) => day.straight_through / day.decided);
  return (
    <div className="live-charts">
      <div className="panel">
        <div className="panel-head">
          <h2>Claims decided a day</h2>
          <p className="panel-note">
            {date(live.since)} to {date(live.until)}
          </p>
        </div>
        <BarSeries
          values={live.series.map((day) => ({ name: date(day.day), value: day.decided }))}
          label={`Claims decided each day, oldest first: ${live.series
            .map((day) => String(day.decided))
            .join(", ")}`}
        />
      </div>
      <div className="panel">
        <div className="panel-head">
          <h2>Straight through a day</h2>
          <p className="panel-note">Days with decisions only</p>
        </div>
        {shares.length < 2 ? (
          <p className="muted small">A trend needs two days with decisions.</p>
        ) : (
          <Sparkline
            values={shares}
            label={`Straight-through share on each day with decisions, oldest first: ${busy
              .map((day, index) => `${date(day.day)} ${percent(shares[index] ?? 0)}`)
              .join(", ")}`}
          />
        )}
        <p className="kpi-sub">Latest: {percent(shares.at(-1) ?? null)}</p>
      </div>
    </div>
  );
}

function EvaluationCell({
  row,
  added,
  onAdd,
}: {
  row: Disagreement;
  added: boolean;
  onAdd: (claimId: string) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (added || row.in_evaluation_set) {
    return (
      <span className="chip chip-good">
        <CircleCheck size={13} strokeWidth={1.75} aria-hidden="true" />
        In evaluation set
      </span>
    );
  }
  if (!row.can_add) {
    return <span className="muted small">Needs a handler&apos;s final decision</span>;
  }
  if (!confirming) {
    return (
      <button
        type="button"
        className="button secondary small-button"
        onClick={() => {
          setConfirming(true);
        }}
      >
        <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
        Add to evaluation set
      </button>
    );
  }
  return (
    <div className="live-confirm" role="group" aria-label={`Add ${row.claim_id}`}>
      <p className="small">
        Add {row.claim_id} labelled {decided(row.final_decision, row.final_payout)}? The next whole
        run and the improver will see it.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="button small-button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          onAdd(row.claim_id).catch((caught: unknown) => {
            setError(caught instanceof ApiError ? caught.message : "It couldn't be added.");
            setBusy(false);
          });
        }}
      >
        {busy ? "Adding…" : `Add ${row.claim_id}`}
      </button>
      <button
        type="button"
        className="button secondary small-button"
        disabled={busy}
        onClick={() => {
          setConfirming(false);
        }}
      >
        Cancel
      </button>
    </div>
  );
}

function Disagreements({ api, rows }: { api: Api; rows: Disagreement[] }) {
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const add = useCallback(
    async (claimId: string) => {
      await api.addToEvaluation(claimId);
      setAdded((now) => new Set([...now, claimId]));
    },
    [api],
  );
  // Ready to add first, then the biggest claims.
  const queue = [...rows].sort(
    (a, b) => Number(b.can_add) - Number(a.can_add) || b.amount_claimed - a.amount_claimed,
  );
  const waiting = rows.filter(
    (row) => row.can_add && !row.in_evaluation_set && !added.has(row.claim_id),
  ).length;
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>
          Disagreements to review{" "}
          {waiting > 0 && <span className="chip chip-warn">{waiting} to review</span>}
        </h2>
        <p className="panel-note">
          Where a handler overrode or sent back the agent. Add each to the evaluation set so the
          next round learns from it
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="muted small">No handler has overridden or sent back the agent yet.</p>
      ) : (
        <TableScroll label="Disagreements table">
          <table className="table min-wide">
            <thead>
              <tr>
                <th scope="col">Claim</th>
                <th scope="col">Agent decided</th>
                <th scope="col">Handler</th>
                <th scope="col">Reason</th>
                <th scope="col">Evaluation set</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((row) => (
                <tr key={row.claim_id}>
                  <th scope="row">
                    <a className="mono nowrap" href={traceHref(row.claim_id)}>
                      {row.claim_id}
                    </a>
                    <span className="sub">
                      {row.claim_type.replaceAll("_", " ")} · {dollars(row.amount_claimed)} claimed
                    </span>
                  </th>
                  <td className="nowrap">{decided(row.agent_decision, row.agent_payout)}</td>
                  <td>
                    {row.kind === "override"
                      ? decided(row.handler_decision, row.handler_payout)
                      : "Sent back"}
                    <span className="sub">
                      {row.by} · {when(row.at)}
                    </span>
                  </td>
                  <td className="prose">
                    {row.reason_code && (
                      <span className="tag">{REASONS[row.reason_code] ?? row.reason_code}</span>
                    )}{" "}
                    <span dir="auto">{row.note}</span>
                  </td>
                  <td>
                    <EvaluationCell row={row} added={added.has(row.claim_id)} onAdd={add} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </div>
  );
}

function CustomerFeedback({ live }: { live: Live }) {
  const { answers, decisions, comments } = live.feedback;
  const rows: [label: string, votes: typeof answers][] = [
    ["Wattle's answers", answers],
    ["Decision explanations", decisions],
  ];
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Customer feedback</h2>
        <p className="panel-note">Thumbs from the portal, last {live.days} days</p>
      </div>
      <dl className="live-votes">
        {rows.map(([label, votes]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {votes.helpful_share === null ? (
                <span className="muted small">No votes yet</span>
              ) : (
                <>
                  <MiniBar value={votes.helpful_share} />
                  <strong>{percent(votes.helpful_share)}</strong> helpful
                  <span className="muted small">
                    {" "}
                    · {votes.helpful} of {votes.count}
                  </span>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <h3 className="live-sub">Latest thumbs-down comments</h3>
      {comments.length === 0 ? (
        <p className="muted small">No comments in this period.</p>
      ) : (
        <ul className="live-comments">
          {comments.map((comment, index) => (
            <li key={`${comment.created_at}-${String(index)}`}>
              <ThumbsDown size={14} strokeWidth={1.75} aria-hidden="true" />
              <div>
                {/* The customer's own words: text only, never markup. */}
                <p dir="auto">{comment.comment}</p>
                <p className="muted small">
                  {comment.subject === "decision" ? "Decision explanation" : "Wattle's answer"}
                  {comment.claim_id && <span className="mono"> · {comment.claim_id}</span>}
                  {" · "}
                  {when(comment.created_at)}
                  {comment.question && <span dir="auto"> · asked “{comment.question}”</span>}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Production behaviour, not offline runs: what the agents decided on live claims, how often a
 * person disagreed, what it cost, and what customers made of it. */
export function LivePage({ api }: { api: Api }) {
  const heading = useFocusHeading();
  const [days, setDays] = useState<LivePeriod>(14);
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const load = useCallback(() => {
    setError(null);
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    let current = true;
    api.getLive(days).then(
      (found) => {
        if (current) setLive(found);
      },
      (caught: unknown) => {
        if (current) setError(caught instanceof Error ? caught.message : String(caught));
      },
    );
    return () => {
      current = false;
    };
  }, [api, days, generation]);

  // The period just chosen is loading until its own answer arrives.
  const shown = live?.days === days ? live : null;
  const quiet = shown !== null && shown.totals.decided === 0 && shown.totals.reviewed === 0;
  // The detail below the summary, one section at a time, so the page fits the window.
  const [detail, setDetail] = useState<string | null>(null);
  const tabs = [
    ...(quiet ? [] : [{ key: "slices", label: "By version and claim type" }]),
    { key: "disagreements", label: `Disagreements · ${String(shown?.disagreements.length ?? 0)}` },
    { key: "feedback", label: "Customer feedback" },
    { key: "trends", label: "Each agent, day by day" },
  ];
  const open =
    detail ?? (shown?.disagreements.length ? "disagreements" : (tabs[0]?.key ?? "feedback"));
  return (
    <section className="view fit" aria-labelledby="live-heading">
      <header className="page-head">
        <div>
          <p className="eyebrow">Observe · Live</p>
          <h1 id="live-heading" ref={heading} tabIndex={-1}>
            Live
          </h1>
          <p className="lede">
            How the agents behave on real claims, not offline runs. Evaluation copies and red-team
            claims are never counted.
          </p>
        </div>
        <fieldset className="seg page-head-side">
          <legend>Period</legend>
          <div className="seg-track">
            {LIVE_PERIODS.map((value) => (
              <label key={value} className="seg-option">
                <input
                  type="radio"
                  name="live-days"
                  checked={days === value}
                  onChange={() => {
                    setError(null);
                    setDays(value);
                  }}
                />
                <span>{value} days</span>
              </label>
            ))}
          </div>
        </fieldset>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
          <button type="button" className="button secondary" onClick={load}>
            Try again
          </button>
        </p>
      )}
      {!shown && !error && (
        <p role="status" className="loading">
          <LoaderCircle className="spin" size={16} strokeWidth={1.75} aria-hidden="true" />
          Loading the live numbers…
        </p>
      )}
      {shown && (
        <>
          <ExamVsLive live={shown} />
          {quiet ? (
            <div className="panel empty">
              <span className="icon-tile" aria-hidden="true">
                <Activity size={18} strokeWidth={1.75} />
              </span>
              <h2>No live decisions in this period</h2>
              <p className="muted">
                Choose a longer period, or have a handler work claims from the dashboard&apos;s
                queue.
              </p>
            </div>
          ) : (
            <>
              <Tiles live={shown} />
              <Trends live={shown} />
            </>
          )}
          <div className="fill live-detail">
            <div className="audit-filters" role="group" aria-label="Show">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  aria-pressed={open === tab.key}
                  onClick={() => {
                    setDetail(tab.key);
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="fill-scroll live-detail-body">
              {open === "slices" && (
                <div className="live-charts">
                  <SliceTable
                    title="By version"
                    column="Version"
                    rows={shown.by_version}
                    current={shown.version === null ? undefined : `v${String(shown.version)}`}
                  />
                  <SliceTable
                    title="By claim type"
                    column="Claim type"
                    rows={shown.by_claim_type}
                  />
                </div>
              )}
              {open === "disagreements" && <Disagreements api={api} rows={shown.disagreements} />}
              {open === "feedback" && <CustomerFeedback live={shown} />}
              {open === "trends" && <TrendsPanels api={api} />}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
