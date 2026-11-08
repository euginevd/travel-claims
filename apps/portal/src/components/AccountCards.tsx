import { FilePen, Plane, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, type Api, type DelayOffer, type SavedDraft } from "../api";
import { date, dollars, when } from "../format";
import { goTo, myClaimHref, NEW_CLAIM_HREF } from "../useHashRoute";

function delayText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours ? `${String(hours)}h ${String(mins).padStart(2, "0")}m` : `${String(mins)}m`;
}

/** Flights on the customer's trips the flight-status feed shows were late enough to claim. */
export function DelayOffers({ api }: { api: Api }) {
  const [offers, setOffers] = useState<DelayOffer[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.myDelays().then(
      (found) => {
        if (live) setOffers(found);
      },
      () => {
        // The offers are a bonus: without them the page still works.
      },
    );
    return () => {
      live = false;
    };
  }, [api]);

  async function claim(offer: DelayOffer) {
    setBusy(offer.flight_id);
    setError(null);
    try {
      const made = await api.claimDelay(offer.flight_id);
      goTo(myClaimHref(made.claim_id));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We couldn't make that claim.");
      setBusy(null);
    }
  }

  if (offers.length === 0) return null;
  return (
    <section aria-label="Flight delays you can claim" className="offer-list">
      {offers.map((offer) => (
        <div key={offer.flight_id} className="panel offer-card">
          <span className="offer-icon" aria-hidden="true">
            <Plane size={22} strokeWidth={2} />
          </span>
          <div className="offer-main">
            <h2 className="offer-title">
              Your flight {offer.flight} was {delayText(offer.delay_minutes)} late
            </h2>
            <p className="small muted">
              {offer.route} · {date(offer.date)}. Your plan covers delays over{" "}
              {String(offer.waiting_hours)} hours, and we&apos;ve already checked the flight record,
              so there&apos;s nothing to fill in.
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </div>
          <button
            type="button"
            className="button"
            disabled={busy !== null}
            onClick={() => {
              void claim(offer);
            }}
          >
            {busy === offer.flight_id ? "Claiming…" : `Claim ${dollars(offer.estimate)}`}
          </button>
        </div>
      ))}
    </section>
  );
}

/** Where payouts go: the customer's PayID, or a way to add one. */
export function PayoutCard({ api }: { api: Api }) {
  const [payid, setPayid] = useState<string | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.myPayId().then(
      (found) => {
        if (live) setPayid(found);
      },
      () => {
        if (live) setPayid(null);
      },
    );
    return () => {
      live = false;
    };
  }, [api]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      setPayid(await api.setPayId(value.trim()));
      setEditing(false);
      setValue("");
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 422
          ? "That doesn't look like a PayID. Use an email, a mobile number (04…) or an ABN."
          : "We couldn't save that. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (payid === undefined) return null;
  const form = editing || payid === null;
  return (
    <section className="panel payout-card" aria-labelledby="payout-heading">
      <span className="offer-icon" aria-hidden="true">
        <Wallet size={22} strokeWidth={2} />
      </span>
      <div className="offer-main">
        <h2 id="payout-heading" className="offer-title">
          {payid ? "Payouts go to your PayID" : "Get paid in seconds"}
        </h2>
        {!form && payid && <p className="small muted">{payid}</p>}
        {form && (
          <form
            className="payid-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label htmlFor="payid" className="small muted">
              Add a PayID (your email, mobile number or ABN) and approved claims are paid straight
              to your bank.
            </label>
            <div className="payid-row">
              <input
                id="payid"
                autoComplete="email"
                maxLength={320}
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                }}
              />
              <button type="submit" className="button" disabled={saving || !value.trim()}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </form>
        )}
      </div>
      {!form && (
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            setEditing(true);
          }}
        >
          Change
        </button>
      )}
    </section>
  );
}

/** A claim the customer started and didn't send, with a way back to it. */
export function ResumeDraft({ api }: { api: Api }) {
  const [saved, setSaved] = useState<SavedDraft | null>(null);

  useEffect(() => {
    let live = true;
    api.myDraft().then(
      (found) => {
        if (live) setSaved(found);
      },
      () => {
        // Without the saved claim the page still works.
      },
    );
    return () => {
      live = false;
    };
  }, [api]);

  if (!saved) return null;
  return (
    <section className="panel offer-card resume-card" aria-label="A claim you haven't sent">
      <span className="offer-icon" aria-hidden="true">
        <FilePen size={22} strokeWidth={2} />
      </span>
      <div className="offer-main">
        <h2 className="offer-title">You have a claim you haven&apos;t sent</h2>
        <p className="small muted">
          {saved.draft.summary || saved.draft.text || "Started"} · saved {when(saved.updated_at)}
        </p>
      </div>
      <div className="offer-actions">
        <a className="button" href={NEW_CLAIM_HREF}>
          Finish it
        </a>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            void api.discardDraft().then(() => {
              setSaved(null);
            });
          }}
        >
          Discard
        </button>
      </div>
    </section>
  );
}
