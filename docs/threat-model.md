# Threat model

UnderCover in stage 1, on a laptop with made-up data. Extended for AWS in stage 2.

## Data

1. Customers' names, travel and medical details in claims, and bank details for payouts: highly sensitive in production. Made up in stage 1.
2. Decisions, their reasons and payments: confidential. In PostgreSQL.
3. The policy wording, claims manual and context files: internal. Read by the agent through the context layer.
4. The handlers' decisions on the labelled sets: the answer key. Never seen by the claim agent; the held-out set's never seen by the improver either.

## Trust boundaries

5. Claim text and documents from customers enter the agent: untrusted input.
6. The agent's tool calls and decisions drive payments: model output leading to a real action.
7. The improver changes the claim agent's configuration: one AI changing another's instructions.
8. The Copilot acts for a signed-in handler: a chat that can sign off payouts.

## Threats and controls

9. Instructions hidden in a claim make the agent approve or pay it (OWASP LLM01). Controls: the hidden-instruction check on a separate model before the claim agent sees the claim (spec 23), content kept apart from instructions (code-standards 18), limits in code (spec 29), injection tests.
10. The agent pays more than allowed or pays twice (LLM06). Controls: the payments module checks the limit before it reads the claim and fails closed (code-standards 7), sign-off over $1,000 (spec 21), idempotent payments across restarts (spec 24).
11. The agent reads or acts on another customer's claim or memory (LLM02). Controls: tools take the claim and customer from the agent's context, not the model (spec 32); abuse-case tests (code-standards 11).
12. A bad configuration from the improver. Controls: a senior handler approves every proposal; the keep-or-roll-back rule on the held-out set; the improver can't change the objectives, limits, models allowed, evaluation sets or judge (spec 26).
13. The Copilot signs off without the handler. Controls: it acts with the handler's own sign-in, never the agent's key (spec 31), and pays only after the handler confirms on a card (spec 27).
14. One handler acts as another, or the agent's key acts as a handler. Controls: authorisation on every request, deny by default (code-standards 10); the key never stands in for a handler (spec 31).
15. Personal data leaks into logs. Control: redaction at the source (code-standards 8, spec 34).
16. The Anthropic API key or a secret is committed. Controls: `.env` ignored, the pre-push scan.

## Compliance

17. Stage 1 sends only made-up data to the Anthropic API (spec 35). Privacy Act, CPS 234 and CPS 230 controls are designed in for stage 2, before any real-looking data is used.
