import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { ApiError, FEEDBACK_WORDS, type Api, type Feedback as Saved } from "../api";

interface FeedbackProps {
  api: Api;
  subject: "answer" | "decision";
  /** The claim a decision's vote is on. */
  claimId?: string;
  /** The question an answer was to. */
  question?: string;
  /** Asked in words beside the buttons; without it the thumbs stand alone. */
  prompt?: string;
}

/** A quiet thumbs up or down under an answer or a decision's reason. A thumbs down offers a
 * short comment; voting again changes the vote. */
export function Feedback({ api, subject, claimId, question, prompt }: FeedbackProps) {
  const id = useId();
  const [vote, setVote] = useState<Saved | null>(null);
  const [comment, setComment] = useState("");
  const [commenting, setCommenting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (subject !== "decision" || !claimId) return;
    let live = true;
    api.myDecisionFeedback(claimId).then(
      (found) => {
        if (live && found) setVote(found);
      },
      () => {
        // The vote they gave before is a nicety: without it the buttons start unpressed.
      },
    );
    return () => {
      live = false;
    };
  }, [api, subject, claimId]);

  async function cast(helpful: boolean, words = "") {
    setBusy(true);
    setError(null);
    try {
      const saved = await api.giveFeedback({
        subject,
        claim_id: claimId,
        helpful,
        comment: words.trim() || undefined,
        question: question?.slice(0, FEEDBACK_WORDS) || undefined,
        feedback_id: subject === "answer" ? vote?.feedback_id : undefined,
      });
      setVote(saved);
      setCommenting(!helpful && !words.trim());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We couldn't save that.");
    } finally {
      setBusy(false);
    }
  }

  const yes = prompt ? "Yes" : "Helpful";
  const no = prompt ? "No" : "Not helpful";
  return (
    <div className="feedback" role="group" aria-label={prompt ?? "Was this answer helpful?"}>
      <div className="feedback-row">
        {prompt && <span className="feedback-prompt">{prompt}</span>}
        <button
          type="button"
          className="feedback-vote"
          aria-pressed={vote?.helpful === true}
          aria-label={prompt ? undefined : yes}
          disabled={busy}
          onClick={() => {
            void cast(true);
          }}
        >
          <ThumbsUp size={15} strokeWidth={1.75} aria-hidden="true" />
          {prompt && yes}
        </button>
        <button
          type="button"
          className="feedback-vote"
          aria-pressed={vote?.helpful === false}
          aria-label={prompt ? undefined : no}
          disabled={busy}
          onClick={() => {
            void cast(false);
          }}
        >
          <ThumbsDown size={15} strokeWidth={1.75} aria-hidden="true" />
          {prompt && no}
        </button>
        {vote && !commenting && (
          <span className="feedback-thanks" role="status">
            Thanks
          </span>
        )}
      </div>
      {vote?.helpful === false && commenting && (
        <form
          className="feedback-comment"
          onSubmit={(event) => {
            event.preventDefault();
            if (comment.trim()) void cast(false, comment);
            else setCommenting(false);
          }}
        >
          <label htmlFor={`${id}-why`} className="visually-hidden">
            What was missing? (optional)
          </label>
          <input
            id={`${id}-why`}
            placeholder="What was missing? (optional)"
            maxLength={FEEDBACK_WORDS}
            value={comment}
            onChange={(event) => {
              setComment(event.target.value);
            }}
          />
          <button type="submit" className="button secondary small-button" disabled={busy}>
            Send
          </button>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
