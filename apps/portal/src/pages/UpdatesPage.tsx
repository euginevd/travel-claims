import { Mail, MessageSquare } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Api, Notice } from "../api";
import { when } from "../format";
import { useFocusHeading } from "../useFocusHeading";
import { myClaimHref } from "../useHashRoute";

type Filter = "all" | "needs" | "payments" | "email" | "sms";
type Tone = "good" | "warm" | "plain";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs", label: "Needs you" },
  { key: "payments", label: "Payments" },
  { key: "email", label: "Emails" },
  { key: "sms", label: "Texts" },
];

/** Whether an update is about money paid, or asks the customer for something. */
export function toneOf(notice: Notice): Tone {
  const text = `${notice.subject} ${notice.body}`.toLowerCase();
  if (/\bpaid\b|\bsent \$|payment/.test(text)) return "good";
  if (/\bneeds? (something|one thing|\d+ thing)/.test(text)) return "warm";
  return "plain";
}

function matches(filter: Filter): (notice: Notice) => boolean {
  return (notice) =>
    filter === "all" ||
    (filter === "needs" && toneOf(notice) === "warm") ||
    (filter === "payments" && toneOf(notice) === "good") ||
    notice.channel === filter;
}

/** The emails and texts we've sent the customer about their claims, newest first. */
export function UpdatesPage({ api }: { api: Api }) {
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const heading = useFocusHeading();
  const retry = useCallback(() => {
    setError(null);
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    let live = true;
    api.myNotices().then(
      (found) => {
        if (live) setNotices(found);
      },
      (caught: unknown) => {
        if (live) setError(caught instanceof Error ? caught.message : String(caught));
      },
    );
    return () => {
      live = false;
    };
  }, [api, generation]);

  const shown = notices?.filter(matches(filter)) ?? [];

  return (
    <section aria-labelledby="updates-heading" className="narrow updates">
      <div className="page-head">
        <div>
          <h1 id="updates-heading" ref={heading} tabIndex={-1}>
            Updates
          </h1>
          <p className="lead">Every email and text we&apos;ve sent you about your claims.</p>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
          <button type="button" className="button secondary" onClick={retry}>
            Try again
          </button>
        </p>
      )}
      {!notices && !error && (
        <p role="status" className="muted">
          Loading your updates…
        </p>
      )}
      {notices?.length === 0 && (
        <div className="panel empty">
          <h2>Nothing yet</h2>
          <p className="muted">When your claim moves on, we&apos;ll email or text you here.</p>
        </div>
      )}
      {notices && notices.length > 0 && (
        <>
          <ul className="filter-chips" aria-label="Show">
            {FILTERS.map(({ key, label }) => (
              <li key={key}>
                <button
                  type="button"
                  className="filter-chip"
                  aria-pressed={filter === key}
                  onClick={() => {
                    setFilter(key);
                  }}
                >
                  {label}
                  <span className="filter-count">{notices.filter(matches(key)).length}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="panel notice-card">
            {shown.length === 0 ? (
              <p className="muted">Nothing here yet.</p>
            ) : (
              <ul className="notice-list">
                {shown.map((notice) => {
                  const tone = toneOf(notice);
                  return (
                    <li key={notice.notice_id} className={`notice-item channel-${notice.channel}`}>
                      <span className={`notice-icon tone-${tone}`} aria-hidden="true">
                        {notice.channel === "sms" ? (
                          <MessageSquare size={17} strokeWidth={1.75} />
                        ) : (
                          <Mail size={17} strokeWidth={1.75} />
                        )}
                      </span>
                      <div className="notice-main">
                        <div className="notice-head">
                          <h2 className="notice-subject">{notice.subject}</h2>
                          <span className="notice-channel">
                            <span>{notice.channel === "sms" ? "Text" : "Email"}</span>
                            <span aria-hidden="true">·</span>
                            <span>{when(notice.sent_at)}</span>
                          </span>
                        </div>
                        <p className="notice-body" dir="auto">
                          {notice.body}
                        </p>
                        {notice.claim_id && (
                          <a href={myClaimHref(notice.claim_id)} className="notice-link">
                            Open claim {notice.claim_id}
                            <span aria-hidden="true"> →</span>
                          </a>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
