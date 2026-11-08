import { Mail, MessageSquare } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Api, Notice } from "../api";
import { when } from "../format";
import { useFocusHeading } from "../useFocusHeading";
import { myClaimHref } from "../useHashRoute";

/** The emails and texts we've sent the customer about their claims, newest first. */
export function UpdatesPage({ api }: { api: Api }) {
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
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

  return (
    <section aria-labelledby="updates-heading" className="narrow">
      <h1 id="updates-heading" ref={heading} tabIndex={-1}>
        Updates
      </h1>
      <p className="lead">Every email and text we&apos;ve sent you about your claims.</p>
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
        <ul className="notice-list">
          {notices.map((notice) => (
            <li key={notice.notice_id} className={`panel notice-item channel-${notice.channel}`}>
              <div className="notice-head">
                <span className="notice-channel">
                  {notice.channel === "sms" ? (
                    <MessageSquare size={16} strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <Mail size={16} strokeWidth={2} aria-hidden="true" />
                  )}
                  {notice.channel === "sms" ? "Text" : "Email"}
                </span>
                <span className="small muted">{when(notice.sent_at)}</span>
              </div>
              <h2 className="notice-subject">{notice.subject}</h2>
              <p className="notice-body" dir="auto">
                {notice.body}
              </p>
              {notice.claim_id && (
                <a href={myClaimHref(notice.claim_id)} className="small">
                  Open claim {notice.claim_id}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
