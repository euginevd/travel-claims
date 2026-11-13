// Every email and text we've sent, as one list: an email and the text sent with it are one item.
import type { Notice } from "../api";

/** One thing we told the customer, by email, by text or both. */
export interface Message {
  /** The message shown: the email when there is one, as it says more. */
  main: Notice;
  channels: Notice["channel"][];
}

// How far apart an email and its text can be sent and still be the same news.
const PAIR_MS = 10_000;

/** Puts each text with the email sent just before it about the same claim, so the same news is
 * listed once. The api sends the email first and the text straight after. */
export function groupNotices(notices: Notice[]): Message[] {
  const emails = new Map(
    notices.filter((notice) => notice.channel === "email").map((n) => [n.notice_id, n]),
  );
  const paired = new Map<number, Notice>();
  for (const text of notices) {
    if (text.channel !== "sms" || text.claim_id === null) continue;
    const email = emails.get(text.notice_id - 1);
    if (
      email?.claim_id === text.claim_id &&
      Math.abs(Date.parse(text.sent_at) - Date.parse(email.sent_at)) <= PAIR_MS
    )
      paired.set(email.notice_id, text);
  }
  const texted = new Set([...paired.values()].map((text) => text.notice_id));
  return notices
    .filter((notice) => !texted.has(notice.notice_id))
    .map((notice) => ({
      main: notice,
      channels: paired.has(notice.notice_id) ? ["email", "sms"] : [notice.channel],
    }));
}

export const SEEN_KEY = "undercover.messages-seen";

/** The newest message the customer has seen, in this browser. */
export function lastSeen(): number {
  try {
    return Number(window.localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function markSeen(notices: Notice[]): void {
  const newest = Math.max(0, ...notices.map((n) => n.notice_id));
  try {
    window.localStorage.setItem(SEEN_KEY, String(newest));
  } catch {
    // Without storage the dot simply shows again next visit.
  }
}
