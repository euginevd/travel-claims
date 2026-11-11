# Spec

`travel-claims`: UnderCover, an AI claims platform for a fictional travel insurer, rebuilt from the UnderCover project in Ed Donner's AI FDE course ([`week3day5-end`](https://github.com/ed-donner/undercover) is the reference for behaviour and data; the code is written fresh, with credit).

Profile: `prototype`, for the whole project (decision 31): no real users, customer data or payments, every record made up, and `dev` the only environment. What that changes is in [AGENTS.md](../AGENTS.md) rule 24.

The business and the app at a high level. What each app does: [features.md](features.md); what's next: [TODO.md](../TODO.md), where new requirements start; why: [decisions.md](decisions.md); risks: [threat-model.md](threat-model.md); tier 2's design: [the AWS architecture](../guides/03-aws-architecture.md).

## Business

Who the business is, unnumbered so the spec's numbers stay put. It changes only when the business does.

- Business: UnderCover Travel Insurance (fictional), an Australian travel insurer, from Ed Donner's AI FDE course. Everything in its data is invented.
- Plans: Economy, Premium and First. A small claims team works the queue by hand.
- Regulators and laws: APRA (CPS 234 information security, CPS 230 operational risk), ASIC, the Privacy Act (including the automated decision-making rules from 10 December 2026) and the Notifiable Data Breaches scheme.
- Data: customer data stays in Australia.
- Risk appetite: low for customer data and payments. Changes ship to `dev`, the only environment while the profile is `prototype` (decision 28).
- Systems: the policy and claims records are the system of record; payments are simulated; handlers sign in with Amazon Cognito (a local stand-in in tier 1).
- People: the head of claims operations owns the claims rules and the approval limit; data governance owns the context layer; the security team approves new data flows.
- Tone: plain, friendly English; no insurance jargon.

## Project

1. Problem: handlers work through a queue of travel claims by hand, so simple claims wait days to be paid (Business, above).
2. Goal: an AI agent decides routine claims as accurately as a handler, so handlers spend their time only on claims that need judgement.
3. Users: customers make and track claims; handlers work the queue, and senior handlers sign off large payouts and can pause payouts; AI engineers evaluate, improve and red-team the agent.

## Tiers

4. **Tier 1, local (Docker), built:** every app on a laptop with `docker compose up`, Claude through the Anthropic API, made-up data only.
5. **Tier 2, AWS serverless, fully AWS-native:** S3 and CloudFront, Lambda, AgentCore, Cognito, Aurora DSQL, DynamoDB and Claude on Bedrock only, all in `ap-southeast-2` with no VPC, at close to $0 idle; deployed, tested with made-up data, then torn down (decisions 13, 29 and 30). The paid, more secure options for real data are in decision 30. Design: [the AWS architecture](../guides/03-aws-architecture.md).

## Apps

6. `portal` (customers), `dashboard` (handlers) and `console` (the AI assurance console for AI engineers): React, Vite and TypeScript, each with its own sign-in, token issuer and audience (decisions 10, 12). `home`: a static local project page.
7. `api` (claims, decisions, payments, notices; Python, FastAPI, PostgreSQL), `agent` (claim agent, hidden-instruction check, specialists, dispatcher, improver, judge, drafting assistant, red team; LangGraph), `copilot` (handlers' chat agent) and `context` (an MCP server over the policy wording, claims manual and reference data).
8. Models: Claude Sonnet for the claim agent; Claude Haiku for the hidden-instruction check, specialists, judge and drafting assistant; one module per app chooses the Anthropic API or Bedrock.
9. Locally: PostgreSQL and receipts in Docker, a sign-in stand-in issuing Cognito-shaped tokens, and a stand-in flight-status feed.

## Done when

18. **Tier 1:** `docker compose up` runs every feature in [features.md](features.md) end to end; all checks, injection tests and the red team pass; building and testing costs under $10 of Claude, with spending limits on evaluations and improvement; the README documents the stack.
19. **Tier 2:** the pipeline deploys every app to AWS, every app passes its health check, claim data stays in Australia, and the threat model's controls are in place before the repo goes public.

## Rules

The limits every feature keeps, whatever else changes.

20. The agent decides; deterministic code pays and enforces every limit.
21. Claims, documents and receipts are untrusted: hidden text must not change a decision; receipts are typed from their contents and never on a public URL. Customers' feedback comments are shown as plain text and never sent to a model.
22. Each audience signs in through its own issuer and the `api` checks the person on every request; the agent's key never stands in for a person; the Copilot acts as the handler who asked.
23. The agent acts only on its own claim and customer; customer memories are used only for that customer and never in evaluations. The Copilot's memory holds a handler's preferences only, never claim or customer data.
24. The claim agent and the improver never see the held-out set's answers; only the judge reads a handler's reason, one claim at a time, and keeps nothing.
25. Every decision is logged with its reasons; personal data is redacted.
26. Tier 1, and tier 2 while `MODEL_PROVIDER` is `anthropic`, send only made-up data to the Anthropic API; real claim data would go only to Bedrock in Australia.
27. A payout held for sign-off is never paid without a handler.
28. Amounts are in US dollars; the drafting assistant converts a receipt in another currency and marks it for the customer to check. Security baseline: OWASP ASVS 5.0 Level 2.

## Not for now

29. Real payments, real email and texts, quotes and policy sales, and a mobile app.
