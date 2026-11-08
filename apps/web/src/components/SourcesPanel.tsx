import type { Source, Step } from "../api";
import { date } from "../format";

interface Looked {
  source: Source;
  lookups: number;
}

// Every file the agent looked something up in, once each, with how often it was used.
export function sourcesOf(steps: Step[]): Looked[] {
  const byFile = new Map<string, Looked>();
  for (const step of steps) {
    for (const source of step.sources) {
      const seen = byFile.get(source.file);
      if (seen) seen.lookups += 1;
      else byFile.set(source.file, { source, lookups: 1 });
    }
  }
  return [...byFile.values()];
}

export function SourcesPanel({ steps }: { steps: Step[] }) {
  const looked = sourcesOf(steps);
  return (
    <section className="panel" aria-labelledby="sources-heading">
      <h2 id="sources-heading">What the agent looked up</h2>
      {looked.length === 0 ? (
        <p className="muted">Nothing looked up yet.</p>
      ) : (
        <ul className="sources">
          {looked.map(({ source, lookups }) => (
            <li key={source.file}>
              <strong>{source.file}</strong>
              <span className="muted small">
                {" "}
                · {lookups} {lookups === 1 ? "lookup" : "lookups"}
              </span>
              <dl className="source-facts">
                <dt>System</dt>
                <dd>{source.system}</dd>
                <dt>Owner</dt>
                <dd>{source.owner}</dd>
                <dt>Reviewed</dt>
                <dd>{date(source.reviewed)}</dd>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
