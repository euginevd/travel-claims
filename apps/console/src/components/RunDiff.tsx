import { CircleMinus, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import type { Api, RunClaim } from "../api";
import { traceHref } from "../useHashRoute";
import { TableScroll } from "./TableScroll";

const DECIDED: Record<string, string> = {
  approve: "Approve",
  decline: "Decline",
  refer: "Refer",
};

function decided(claim: RunClaim | undefined): string {
  if (!claim?.decision) return "Not decided";
  return DECIDED[claim.decision] ?? claim.decision;
}

type Pair = [RunClaim, RunClaim];

/** The claims two runs share, paired by the labelled claim each copies. */
export function pairUp(before: RunClaim[], after: RunClaim[]): Pair[] {
  const byClaim = new Map(before.map((c) => [c.original_claim_id, c]));
  return after.flatMap((c) => {
    const old = byClaim.get(c.original_claim_id);
    return old ? [[old, c] as Pair] : [];
  });
}

/** Each claim two runs decided differently, lost ones first, with a trace link for each side. */
export function RunDiff({
  api,
  before,
  after,
  beforeLabel,
  afterLabel,
  headingId,
  title = "Claim by claim",
}: {
  api: Api;
  before: number;
  after: number;
  beforeLabel: string;
  afterLabel: string;
  headingId: string;
  title?: string;
}) {
  const [pairs, setPairs] = useState<{ key: string; found: Pair[] } | null>(null);
  const key = `${String(before)}-${String(after)}`;

  useEffect(() => {
    let live = true;
    Promise.all([api.getRun(before), api.getRun(after)]).then(
      ([old, next]) => {
        if (live) setPairs({ key, found: pairUp(old.claims, next.claims) });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api, before, after, key]);

  if (pairs?.key !== key) return null;
  const all = pairs.found;
  const changed = all.filter(([old, next]) => old.decision !== next.decision);
  const lost = changed.filter(([old, next]) => old.matched && !next.matched);
  const gained = changed.filter(([old, next]) => !old.matched && next.matched);
  const other = changed.filter((pair) => !lost.includes(pair) && !gained.includes(pair));
  return (
    <section className="claim-by-claim" aria-labelledby={headingId}>
      <h3 id={headingId}>{title}</h3>
      <p className="small muted">
        {all.length === 0
          ? "These runs share no claims: pick two runs on the same set."
          : `${String(all.length - changed.length)} of ${String(all.length)} shared claims decided the same. ${String(lost.length)} got worse, ${String(gained.length)} got better.`}
      </p>
      {changed.length > 0 && (
        <TableScroll label="Claims decided differently table">
          <table className="table min-mid">
            <thead>
              <tr>
                <th scope="col">Claim</th>
                <th scope="col">Handler</th>
                <th scope="col">{beforeLabel}</th>
                <th scope="col">{afterLabel}</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {[...lost, ...gained, ...other].map(([old, next]) => (
                <tr key={next.original_claim_id}>
                  <th scope="row" className="prose">
                    {next.summary}
                    <span className="sub mono">{next.original_claim_id}</span>
                  </th>
                  <td>{next.handler_decision ? (DECIDED[next.handler_decision] ?? "–") : "–"}</td>
                  <td>
                    <a href={traceHref(old.claim_id)}>{decided(old)}</a>
                  </td>
                  <td>
                    <a href={traceHref(next.claim_id)}>{decided(next)}</a>
                  </td>
                  <td>
                    {old.matched && !next.matched ? (
                      <span className="chip chip-bad">
                        <TrendingDown size={13} strokeWidth={1.75} aria-hidden="true" />
                        Worse
                      </span>
                    ) : !old.matched && next.matched ? (
                      <span className="chip chip-good">
                        <TrendingUp size={13} strokeWidth={1.75} aria-hidden="true" />
                        Better
                      </span>
                    ) : (
                      <span className="chip">
                        <CircleMinus size={13} strokeWidth={1.75} aria-hidden="true" />
                        Different, both wrong
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </section>
  );
}
