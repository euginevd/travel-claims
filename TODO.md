# To do

Ideas and tasks, numbered. The agent confirms with you before starting one and removes it when done.

1. Make the Copilot's busy lock hold across instances, and take the pending card before reading it, so two Lambda instances can't act on one card (status 61).
2. Treat a payment refused because the approval limit was lowered after the approval as a hold for sign-off, not a claim left in progress (status 61).
3. **Add to evaluation set**: tell "added" from "already added" by the row, not the engineer's name (status 61).
4. Bound the Live and similar-claims queries, which read every decision (status 61).
5. A unique index on decision feedback (status 61).
6. Close the Copilot's HTTP clients on shutdown (status 61).
