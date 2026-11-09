# Spec

`travel-claims`: UnderCover, an AI claims platform for a fictional travel insurer, rebuilt from the UnderCover project in Ed Donner's AI FDE course ([`week3day5-end`](https://github.com/ed-donner/undercover) is the reference for behaviour and data; the code is written fresh, with credit).

## Project

1. Problem: handlers work through a queue of travel claims by hand, so simple claims wait days to be paid (`business-context.md`).
2. Goal: an AI agent decides routine claims as accurately as a handler, so handlers spend their time only on claims that need judgement.
3. Users: customers make and track claims; handlers work the queue, and senior handlers sign off large payouts and can pause payouts; AI engineers evaluate, improve and red-team the agent.

## Stages

4. **Stage 1, local build and test (built):** every app on a laptop with `docker compose up`, Claude through the Anthropic API, made-up data only.
5. **Stage 2, AWS build, test and deploy (planned):** the same images on EKS in `ap-southeast-2` with Aurora PostgreSQL, Cognito, Claude on Bedrock (Australian inference profile), Bedrock Guardrails, Secrets Manager and ECR; the pipeline deploys `dev` on merge and `prod` by hand. Spec'd in detail before it starts.

## Apps

6. `portal` (customers), `dashboard` (handlers) and `console` (the AI assurance console for AI engineers): React, Vite and TypeScript, each with its own sign-in, token issuer and audience (decisions 10, 12). `home`: a static local project page.
7. `api` (claims, decisions, payments, notices; Python, FastAPI, PostgreSQL), `agent` (claim agent, hidden-instruction check, specialists, dispatcher, improver, drafting assistant, red team; LangGraph), `copilot` (handlers' chat agent) and `context` (an MCP server over the policy wording, claims manual and reference data).
8. Models: Claude Sonnet for the claim agent; Claude Haiku for the hidden-instruction check, specialists and drafting assistant; one module per app chooses the Anthropic API or Bedrock.
9. Locally: PostgreSQL and receipts in Docker, a sign-in stand-in issuing Cognito-shaped tokens, and a stand-in flight-status feed.

## What it does

10. **Customers** see only their own claims; make a claim photo first, with an AI drafting assistant and up to five receipts (JPEG, PNG or PDF, 5 MB each), saved to finish later; and claim a delayed flight in one tap when the flight-status feed shows it qualifies.
11. **Customers** follow each claim on a tracker with a plain-English reason and an AI disclosure, upload each document asked for, ask a person to review a decision, get paid to a PayID, and see every email and text in Updates (an outbox in stage 1). They can ask an assistant about their policy and claims, answered from customer-facing sources only, citing the wording and never promising cover.
12. **The hidden-instruction check** reads every claim and receipt first, on a separate model; a claim with hidden instructions goes to a handler and the claim agent never sees it.
13. **The claim agent** uses the context layer, specialists (document checker, duplicate receipts, medical reviewer) and the customer's earlier claims to approve, decline or refer, with the payout from the payout rules and a decision record that meets claims manual section 14 or is refused. A referral can ask the customer for documents.
14. **Payments:** an approval under $1,000 is paid at once, and a claim is paid once at most; anything over waits for a senior handler's sign-off. A senior handler can pause all payouts, and approvals then hold.
15. **Handlers** get a queue with what needs them first, a case brief (recommendation, checklist with sources, payout lines, screened claims flagged), and sign off, send back, override with a reason code, ask the customer, or send an AI-drafted letter they've checked. Wattle AI (the Copilot) acts as the handler and signs off only after they confirm.
16. **AI engineers** run evaluations on labelled sets with 1 to 25 agents at once (restart-safe), see scores, misses and any claim's tokens and cost, approve or reject the improver's proposals (kept only if the held-out scores improve and every red-team attack holds against it), and run the red team: eight attack claims mapped to the OWASP Top 10 for LLMs, none of which may end paid.
17. **The project page** explains the project, shows live counts and links to the three apps; local only, no customer data.

## Done when

18. **Stage 1:** `docker compose up` runs 10 to 17 end to end; all checks, injection tests and the red team pass; building and testing costs under $10 of Claude, with spending limits on evaluations and improvement; `status.md` documents the stack.
19. **Stage 2:** the pipeline deploys the same images to AWS, every app passes its health check, claim data stays in Australia, and the threat model's controls are in place before the repo goes public.

## Rules

20. The agent decides; deterministic code pays and enforces every limit.
21. Claims, documents and receipts are untrusted: hidden text must not change a decision; receipts are typed from their contents and never on a public URL.
22. Each audience signs in through its own issuer and the `api` checks the person on every request; the agent's key never stands in for a person; the Copilot acts as the handler who asked.
23. The agent acts only on its own claim and customer; customer memories are used only for that customer and never in evaluations.
24. The agent and the improver never see the held-out set's answers.
25. Every decision is logged with its reasons; personal data is redacted.
26. Stage 1 sends only made-up data to the Anthropic API; from stage 2, claim data goes only to Bedrock in Australia.
27. A payout held for sign-off is never paid without a handler.
28. Amounts are in US dollars. Security baseline: OWASP ASVS 5.0 Level 2.

## Not for now

29. Real payments, real email and texts, quotes and policy sales, and a mobile app.
