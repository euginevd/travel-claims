import { useCallback, useEffect, useState } from "react";
import type { Api, ExamGrowth as Growth } from "../api";
import { dollars, when } from "../format";
import { wilson } from "../stats";
import { traceHref } from "../useHashRoute";
import { Meter } from "./Charts";
import { TableScroll } from "./TableScroll";

/** How wide an 84% score's likely range is on an exam of this size, in points. */
function spread(claims: number): number {
  if (claims <= 0) return 100;
  const range = wilson(0.84, claims);
  return range ? Math.round((range[1] - range[0]) * 100) : 100;
}

/** The exam grows from claims a person decided: each added makes a score's range narrower.
 * The exam is never shown to the agent or the improver. */
export function ExamGrowth({ api }: { api: Api }) {
  const [growth, setGrowth] = useState<Growth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  const load = useCallback(() => {
    api.getExamGrowth().then(setGrowth, (caught: unknown) => {
      setError(caught instanceof Error ? caught.message : String(caught));
    });
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(claimId: string) {
    setAdding(claimId);
    setError(null);
    try {
      await api.addToExam(claimId);
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setAdding(null);
    }
  }

  if (!growth) {
    return error ? (
      <p className="muted panel">Couldn&apos;t load the exam&apos;s size: {error}</p>
    ) : null;
  }
  return (
    <section className="panel" aria-labelledby="exam-growth-heading">
      <div className="panel-head">
        <h2 id="exam-growth-heading">Grow the exam</h2>
        <span className="muted small">
          {growth.exam_size} of {growth.target} claims
        </span>
      </div>
      <Meter value={Math.min(1, growth.exam_size / growth.target)} />
      <p className="small muted">
        At {growth.exam_size} claims an 84% score could sit anywhere in a {spread(growth.exam_size)}
        -point range; at {growth.target} it narrows to {spread(growth.target)} points. Add claims a
        senior handler decided; the agent and the improver never see their answers.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {growth.candidates.length === 0 ? (
        <p className="muted small">
          No claim a person decided is waiting to join. Each one a senior handler signs off or
          overrides becomes one.
        </p>
      ) : (
        <TableScroll label="Exam candidates table">
          <table className="table min-wide">
            <thead>
              <tr>
                <th scope="col">Claim</th>
                <th scope="col">Decided</th>
                <th scope="col">By</th>
                <th scope="col">
                  <span className="visually-hidden">Add</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {growth.candidates.map((one) => (
                <tr key={one.claim_id}>
                  <th scope="row">
                    <a className="mono" href={traceHref(one.claim_id)}>
                      {one.claim_id}
                    </a>
                    <span className="sub" dir="auto">
                      {one.summary}
                    </span>
                  </th>
                  <td>
                    {one.decision}
                    {one.decision === "approve" ? ` ${dollars(one.payout)}` : ""}
                  </td>
                  <td className="small">
                    {one.decided_by}
                    <span className="sub">{when(one.decided_at)}</span>
                  </td>
                  <td className="num">
                    <button
                      type="button"
                      className="button secondary"
                      disabled={adding !== null}
                      onClick={() => void add(one.claim_id)}
                    >
                      {adding === one.claim_id ? "Adding…" : "Add to the exam"}
                    </button>
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
