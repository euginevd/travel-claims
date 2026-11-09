import { FileText, Image as ImageIcon, Sparkle, UserRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ApiError, type Api, type CustomerClaim } from "../api";
import { ClaimTracker } from "../components/ClaimTracker";
import { NeedsPanel } from "../components/NeedsPanel";
import { kilobytes, ReceiptPicker } from "../components/ReceiptPicker";
import { CustomerStatusChip } from "../components/StatusChip";
import { CLAIM_TYPES } from "./NewClaimPage";
import { date, dollars, when } from "../format";
import { useFocusHeading } from "../useFocusHeading";
import { MY_CLAIMS_HREF } from "../useHashRoute";

interface MyClaimPageProps {
  api: Api;
  claimId: string;
}

export function MyClaimPage({ api, claimId }: MyClaimPageProps) {
  const [claim, setClaim] = useState<CustomerClaim | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [askNote, setAskNote] = useState("");
  const [askError, setAskError] = useState<string | null>(null);
  const heading = useFocusHeading();
  const retry = useCallback(() => {
    setError(null);
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    let live = true;
    api.myClaim(claimId).then(
      (found) => {
        if (live) setClaim(found);
      },
      (caught: unknown) => {
        if (live) setError(caught instanceof Error ? caught.message : String(caught));
      },
    );
    return () => {
      live = false;
    };
  }, [api, claimId, generation]);

  async function send() {
    setSending(true);
    setSendError(null);
    try {
      const updated = await api.addReceipts(claimId, files);
      setClaim(updated);
      setNotice(`${String(files.length)} receipt${files.length === 1 ? "" : "s"} added.`);
      setFiles([]);
    } catch (caught) {
      setSendError(caught instanceof ApiError ? caught.message : "We couldn't send the receipts.");
    } finally {
      setSending(false);
    }
  }

  async function askForPerson() {
    setAsking(true);
    setAskError(null);
    try {
      setClaim(await api.requestReview(claimId, askNote.trim()));
    } catch (caught) {
      setAskError(caught instanceof ApiError ? caught.message : "We couldn't send that.");
    } finally {
      setAsking(false);
    }
  }

  return (
    <section aria-labelledby="my-claim-heading" className="narrow">
      <p>
        <a href={MY_CLAIMS_HREF}>Back to my claims</a>
      </p>
      <h1 id="my-claim-heading" ref={heading} tabIndex={-1}>
        Claim {claimId}
      </h1>
      {error && (
        <p className="error" role="alert">
          {error}
          <button type="button" className="button secondary" onClick={retry}>
            Try again
          </button>
        </p>
      )}
      {!claim && !error && (
        <div aria-hidden="true">
          <span className="skeleton skeleton-card" />
          <span className="skeleton skeleton-line" />
          <p role="status" className="visually-hidden">
            Loading your claim…
          </p>
        </div>
      )}
      {claim && (
        <>
          <ClaimTracker status={claim.status} />
          <NeedsPanel api={api} claimId={claimId} requests={claim.requests} onUpdated={setClaim} />
          {claim.letter && (
            <section className="panel letter-card" aria-labelledby="letter-heading">
              <p className="eyebrow">A letter from UnderCover · {when(claim.letter.sent_at)}</p>
              <h2 id="letter-heading">{claim.letter.subject}</h2>
              <p className="letter-body" dir="auto">
                {claim.letter.body}
              </p>
            </section>
          )}
          <div className="panel outcome-card">
            <div className="claim-card-head">
              <h2>Where it stands</h2>
              <CustomerStatusChip status={claim.status} />
            </div>
            <p>{claim.status_text}</p>
            {claim.paid !== null && (
              <p className="payout">
                {dollars(claim.paid)}
                {claim.paid_at && (
                  <span className="small muted">
                    {" "}
                    {claim.paid_to ? `sent to your ${claim.paid_to}` : "paid"} {when(claim.paid_at)}
                  </span>
                )}
              </p>
            )}
            {claim.reason && (
              <>
                <h3>Why</h3>
                <p dir="auto">{claim.reason}</p>
              </>
            )}
            {claim.outcome && claim.outcome !== "refer" && (
              <p className="ai-mark">
                <Sparkle size={14} strokeWidth={2} aria-hidden="true" />
                Decided with help from our AI claims agent
              </p>
            )}
            {claim.review_requested && (
              <p className="notice" role="status">
                <UserRound size={16} strokeWidth={2} aria-hidden="true" /> A claims handler will
                review your claim personally and contact you.
              </p>
            )}
            {claim.can_request_review && (
              <div className="ask-person">
                <label htmlFor="ask-note">
                  Want a person to look at this? Tell us why (optional)
                </label>
                <textarea
                  id="ask-note"
                  rows={2}
                  maxLength={1000}
                  value={askNote}
                  onChange={(event) => {
                    setAskNote(event.target.value);
                  }}
                />
                {askError && (
                  <p className="error" role="alert">
                    {askError}
                  </p>
                )}
                <button
                  type="button"
                  className="button secondary"
                  disabled={asking}
                  onClick={() => {
                    void askForPerson();
                  }}
                >
                  <UserRound size={16} strokeWidth={2} aria-hidden="true" />
                  {asking ? "Sending…" : "Ask a person to review"}
                </button>
              </div>
            )}
          </div>

          <div className="panel">
            <h2>Your claim</h2>
            <dl className="facts">
              <dt>What happened</dt>
              <dd dir="auto">{claim.summary}</dd>
              <dt>Type</dt>
              <dd>{CLAIM_TYPES[claim.claim_type] ?? claim.claim_type}</dd>
              <dt>When</dt>
              <dd className="nowrap">{date(claim.incident_date)}</dd>
              <dt>Where</dt>
              <dd dir="auto">{claim.incident_location}</dd>
              <dt>Policy</dt>
              <dd className="nowrap">{claim.policy_id}</dd>
            </dl>
            <h3>In your words</h3>
            <p className="story" dir="auto">
              {claim.story}
            </p>
            <table className="items">
              <caption>What you&apos;re claiming</caption>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col" className="number">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {claim.items.map((item, index) => (
                  <tr key={String(index)}>
                    <td dir="auto">{item.description}</td>
                    <td className="number">{dollars(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td className="number">{dollars(claim.amount_claimed)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="panel">
            <h2>Receipts</h2>
            {claim.receipts.length === 0 ? (
              <p className="muted">No receipts yet.</p>
            ) : (
              <ul className="receipt-list">
                {claim.receipts.map((receipt, index) => (
                  <li key={receipt.receipt_id}>
                    {receipt.media_type === "application/pdf" ? (
                      <FileText size={18} strokeWidth={2} aria-hidden="true" />
                    ) : (
                      <ImageIcon size={18} strokeWidth={2} aria-hidden="true" />
                    )}
                    Receipt {index + 1}
                    <span className="small muted">
                      {" "}
                      · {receipt.media_type === "application/pdf" ? "PDF" : "Image"} ·{" "}
                      {kilobytes(receipt.size)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {notice && (
              <p className="notice" role="status">
                {notice}
              </p>
            )}
            {claim.can_add_receipts && (
              <>
                <ReceiptPicker files={files} onChange={setFiles} already={claim.receipts.length} />
                {sendError && (
                  <p className="error" role="alert">
                    {sendError}
                  </p>
                )}
                {files.length > 0 && (
                  <button
                    type="button"
                    className="button"
                    disabled={sending}
                    onClick={() => {
                      void send();
                    }}
                  >
                    {sending ? "Sending…" : "Add these receipts"}
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
