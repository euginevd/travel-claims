# Spec

A worked example: `travel-claims`, in production. For a new project, replace it by hand or ask the agent to draft one from your notes. The user approves every change.

## Project

1. Name: `travel-claims`
2. Problem: claims handlers work through a queue of travel insurance claims by hand, so simple claims wait days to be paid.
3. Goal: an AI agent decides routine claims in minutes, and handlers spend their time only on claims that need judgement.
4. Users: claimants submit and track claims; handlers review and sign off; admins manage users and limits.
5. AWS: accounts `travel-claims-dev` and `travel-claims-prod`, region `ap-southeast-2`, environments `dev` and `prod`.

## Stack

Template defaults: GitHub Actions, Terraform on AWS and the Gitleaks and Trivy pre-push scan.

6. `web`: React, Vite and TypeScript, hosted on S3 and CloudFront. Checks: `npm run lint`, `npm run typecheck`, `npm test`.
7. `api`: Python and FastAPI on Lambda behind an HTTP API. Checks: `uv run ruff check`, `uv run pyright`, `uv run pytest`.
8. `agent`: Python and LangGraph on Lambda, calling Claude on Amazon Bedrock. Checks: `uv run ruff check`, `uv run pyright`, `uv run pytest`.

## Done when

9. A claimant can submit a claim with receipts and see its status.
10. The agent decides each claim and gives reasons that quote the policy wording.
11. Claims the agent approves under $1,000 are paid automatically; the rest wait for a handler.
12. A handler can approve, decline or send back a claim from the dashboard.
13. No payment exceeds the policy limit, whatever the agent decides.

## Rules

14. Claims hold passport, bank and medical details, so the laws in `business-context.md` apply.
15. The agent decides; deterministic code pays and enforces every limit.
16. Bedrock calls use the Australian cross-region inference profile, so claim data stays in Australia.
17. Receipts are untrusted input: text hidden in them must not change a decision.
18. Every decision is logged with its reasons, with personal data redacted.
19. AWS spend stays under $200 a month in `dev`.

## Not for now

20. Quotes and policy sales: claims only.
21. A mobile app.
22. Claims in currencies other than AUD.
23. Fraud detection beyond the payment checks.
