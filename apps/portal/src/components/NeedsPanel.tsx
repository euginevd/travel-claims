import { CircleCheck, CircleDashed, Upload } from "lucide-react";
import { useId, useState } from "react";
import { ApiError, type Api, type CustomerClaim, type CustomerRequest } from "../api";
import { when } from "../format";

const ACCEPT = "image/jpeg,image/png,application/pdf";

interface NeedsPanelProps {
  api: Api;
  claimId: string;
  requests: CustomerRequest[];
  onUpdated: (claim: CustomerClaim) => void;
}

/** What we've asked the customer for on a claim, each with its own way to send it. */
export function NeedsPanel({ api, claimId, requests, onUpdated }: NeedsPanelProps) {
  const open = requests.filter((request) => request.fulfilled_at === null).length;
  if (requests.length === 0) return null;
  return (
    <section className={`panel needs-panel${open ? " has-open" : ""}`} aria-labelledby="needs">
      <h2 id="needs">{open ? "What we need from you" : "What you sent us"}</h2>
      <p className="muted small">
        {open
          ? `${String(open)} ${open === 1 ? "thing" : "things"} to send. A photo or PDF of each is fine.`
          : "Thanks, you've sent everything we asked for. We'll take it from here."}
      </p>
      <ul className="needs-list">
        {requests.map((request) => (
          <NeedRow
            key={request.request_id}
            first={request === requests.find((each) => each.fulfilled_at === null)}
            api={api}
            claimId={claimId}
            request={request}
            onUpdated={onUpdated}
          />
        ))}
      </ul>
    </section>
  );
}

function NeedRow({
  api,
  first,
  claimId,
  request,
  onUpdated,
}: {
  api: Api;
  /** The first thing still to send carries the page's one main button. */
  first: boolean;
  claimId: string;
  request: CustomerRequest;
  onUpdated: (claim: CustomerClaim) => void;
}) {
  const id = useId();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = request.fulfilled_at !== null;

  async function send(files: File[]) {
    if (files.length === 0) return;
    setSending(true);
    setError(null);
    try {
      onUpdated(await api.answerRequest(claimId, request.request_id, files));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We couldn't send that.");
    } finally {
      setSending(false);
    }
  }

  return (
    <li className={`need-row${done ? " done" : ""}`}>
      {done ? (
        <CircleCheck size={20} strokeWidth={1.75} aria-hidden="true" className="need-icon" />
      ) : (
        <CircleDashed size={20} strokeWidth={1.75} aria-hidden="true" className="need-icon" />
      )}
      <div className="need-main">
        <p className="need-text" dir="auto">
          {request.text}
        </p>
        <p className="small muted">
          {done && request.fulfilled_at
            ? `Sent ${String(request.files)} ${request.files === 1 ? "file" : "files"}, ${when(request.fulfilled_at)}`
            : `Asked ${when(request.asked_at)}`}
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      {!done && (
        <>
          <input
            id={id}
            className="visually-hidden"
            type="file"
            accept={ACCEPT}
            multiple
            disabled={sending}
            onChange={(event) => {
              void send(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <label
            htmlFor={id}
            className={`button small-button${first ? "" : " secondary strong"}`}
            aria-disabled={sending}
          >
            <Upload size={16} strokeWidth={1.75} aria-hidden="true" />
            {sending ? "Sending…" : "Upload"}
            <span className="visually-hidden">: {request.text}</span>
          </label>
        </>
      )}
    </li>
  );
}
