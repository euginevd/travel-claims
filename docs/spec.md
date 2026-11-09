# Spec

`travel-claims`: UnderCover, an AI claims platform for a fictional travel insurer, rebuilt from the UnderCover project in Ed Donner's AI FDE course. Built in stages: first the whole app on a laptop, then on AWS, then hardened and published.

## Project

1. Name: `travel-claims`. The business is UnderCover, a fictional insurer (`business-context.md`).
2. Problem: claims handlers work through a queue of travel insurance claims by hand, so simple claims wait days to be paid.
3. Goal: an AI agent decides routine claims as accurately as a handler, and handlers spend their time only on claims that need judgement.
4. Users: customers (policyholders) sign in, submit a claim with receipts and track their own claims; handlers work the queue and sign off large payouts; senior handlers also run evaluations and improvement rounds and change settings.
5. Source: the course repo's `week3day5-end` branch is the reference for behaviour and data. The code here is written fresh, with credit to the course.

## Stages

6. **Stage 1, local (now):** the whole app runs on a laptop with `docker compose up`, calling Claude through the Anthropic API with the user's own key, on the course's made-up data only.
7. **Stage 2, AWS** *(planned)*: the same containers on AWS in `ap-southeast-2`, deployed by the pipeline. EKS, Aurora PostgreSQL, Cognito, Claude on Bedrock through the Australian inference profile, Bedrock Guardrails, Secrets Manager and ECR. Spec'd in detail before it starts.
8. **Stage 3, hardened and published** *(planned)*: the security controls in `threat-model.md` across every DevSecOps stage, then the repo made public and posted on LinkedIn.

Stage 1 is built in four plans, each working end to end before the next: the claim flow, the dispatcher and evaluations, the improver, and the Copilot.

## Stack

Template defaults: GitHub Actions, Terraform on AWS (stage 2) and the Gitleaks and Trivy pre-push scan. Each app has its own Dockerfile from stage 1, so stage 2 ships the same images.

9. `portal` and `dashboard`: the customers' portal and the handlers' dashboard, as two React, Vite and TypeScript apps on separate addresses, each with its own sign-in, token issuer and audience (decision 10). React, Vite and TypeScript. Checks: `npm run lint`, `npm run typecheck`, `npm test`.
10. `api`: claims, policies, decisions, payments, settings and records. Python, FastAPI and SQLAlchemy on PostgreSQL. Payments are a module of their own that checks every limit in code. Checks: `uv run ruff check`, `uv run pyright`, `uv run pytest`.
11. `agent`: the claim agent, the hidden-instruction check, the dispatcher and the improver. Python and LangGraph, with progress saved to PostgreSQL. Same checks as `api`.
12. `copilot`: the handlers' chat agent. Python and LangGraph. Same checks as `api`.
13. `context`: the context layer, an MCP server over the policy wording, claims manual, plans, rules and reference data. Same checks as `api`.
14. Models: one module per app reaches Claude, through the Anthropic API in stage 1 and Bedrock in stage 2, chosen by settings. The claim agent runs on Claude Sonnet, and the hidden-instruction check and the judge on Claude Haiku, with explicit model IDs (code-standards 19).
15. Local services: PostgreSQL in Docker; a local sign-in stand-in for handlers and customers that issues tokens shaped like Cognito's, so the `api` checks them the same way in both stages (customers get Google through Cognito in stage 2); receipts on a local Docker volume behind one storage module (a private, encrypted S3 bucket in stage 2). The agent's memory of customers is kept in PostgreSQL.
16. End-to-end: Playwright against the running stack, with the models stubbed.
17. Machine: Docker Desktop, uv, Node and an Anthropic API key in `.env`, which is never committed.

## Done when (stage 1)

18. `docker compose up` starts every app; a handler signs in and sees the queue.
19. The agent works a claim: the hidden-instruction check first, then lookups in the context layer, then approve, decline or refer, with the payout worked out by the payout rules and a reason that quotes the policy wording.
20. Every decision record meets claims manual section 14, or the `api` refuses it, saying what's missing.
21. An approval under $1,000 is paid at once; anything over waits for a handler who can sign it off or send it back with a note, and the agent decides again.
22. The `api` refuses any payment over the approval limit, whatever the agent does.
23. A claim with instructions hidden in it goes to a handler, and the claim agent's model never sees it.
24. A dispatch works the queue with 1 to 25 claim agents at once, survives a restart without deciding or paying any claim twice, and summarises itself from the records.
25. An evaluation scores the agent against the handlers' decisions on a labelled set, and the scoreboard shows it.
26. The improver proposes a new configuration, an AI engineer approves or rejects it in the AI assurance console, and the keep-or-roll-back rule decides on the held-out set.
27. The Copilot answers a handler's questions from the records and signs off a held payout only after the handler confirms on a card.
28. All checks and the injection tests pass, and the local stack is documented in `status.md`.
29. A customer signs in, sees only their own policy and claims with a plain-English status and reason, and submits a claim with up to five receipts (JPEG, PNG or PDF, 5 MB each); the hidden-instruction check reads the receipts before the claim agent does, and Claude reads them when deciding.
30. Customers file photo first and type little: they snap a receipt or pick a common case, an AI drafting assistant (Claude Haiku) asks only what's missing and drafts the summary, items, amounts and dates, tagging where each came from and highlighting what it's unsure of; the customer confirms or fixes it before submitting. The assistant only drafts; the hidden-instruction check screens the customer's own words and receipts, and the claim agent reads the customer's original story as the record.
31. Customers follow their claim on a plain status tracker, and can ask for a person to review any decision.
32. Handlers see a case brief by default: a stage tracker (received, checked, assessed, decided, paid), a banner only when something needs them, a recommendation card with the outcome, the reason and a checklist of what was verified (exceptions first, each line linked to its receipt or clause), and the payout bar. They can sign off, send back, or override with a reason code. The agent's live activity sits in a separate panel, and a trace toggle shows the raw tool calls, JSON and sources; tokens and cost are in the AI assurance console's claim trace.
33. The queue puts what needs a handler first, with keyboard shortcuts and a command palette. AI-produced content carries one consistent marker in both apps.

## Rules

34. The agent decides; deterministic code pays and enforces every limit (code-standards 17).
35. Claim text and documents are untrusted input: text hidden in them must not change a decision.
36. Handlers sign in, and the `api` checks the handler on every request. The agent uses its own API key, which never stands in for a handler; the Copilot acts as the handler who asked.
37. The agent acts only on its own claim and reads only its own customer's records. Each customer's memories are used only for that customer's claims.
38. The agent and the improver never see the handlers' decisions on the held-out set.
39. Every decision is logged with its reasons, with personal data redacted.
40. Stage 1 sends only the course's made-up data to the Anthropic API. From stage 2, real-looking claim data goes only to Bedrock in Australia.
41. Amounts are in US dollars, as in the source data.
42. Receipts are untrusted: their type is checked from the file's contents, they're never served on a public URL, and a customer reaches only their own policy, claims and receipts.
43. A payout held for sign-off is never paid without a handler, however long it waits.
44. Security requirements baseline: OWASP ASVS 5.0 Level 2.

## Not for now

45. Real payments, and delivering email and texts to customers (stage 1 keeps an outbox the portal shows).
46. Quotes and policy sales, a mobile app, and fraud detection beyond the payment checks.
47. Anything on AWS until stage 2 is spec'd.

## Advanced agentic features (stage 1)

48. **Evaluations:** a dispatcher works many claims at once (1 to 25 claim agents) and survives a restart without deciding or paying twice; an evaluation runs copies of a labelled set through it and a scoreboard shows accuracy, payout accuracy, the share handled straight through, cost and time per claim, with each miss beside the handler's decision.
49. **Kill switch:** a senior handler can stop all payouts while the app keeps running; the agent still decides and every approval holds until payouts are back on.
50. **Red-team suite:** run by an AI engineer from the AI assurance console, a set of attack claims (instructions hidden in receipt images and PDFs, fake approval notes, goal hijacking, payout inflation) runs on demand with a pass or fail report; every attack must end referred or held, never paid.
51. **Specialist sub-agents:** a document checker (receipts against the story, dates and trip), a duplicate-receipt detector across claims, and a medical reviewer for medical claims; the claim agent calls them and cites them in its checklist.
52. **Improver:** a second agent reads an evaluation's misses and proposes a change to the claim agent's instructions, model or effort as a diff; an AI engineer approves or rejects it; an approved version is kept only if it improves the held-out scores without making any worse, and the improver never sees the held-out answers.
53. **Copilot:** a chat in the staff dashboard that answers from the records and acts as the signed-in handler, never with the agent's key; it signs off only after the handler confirms on a card.
54. **Customer memory:** the agent remembers each customer's earlier claims and decisions, used only for that customer's claims and never in evaluations.
55. **Polish:** Work this claim carries on a claim the agent stopped on; optionally the agent starts as soon as a customer submits.
56. Claude spend for building and testing these stays under $10 in all; evaluations and improvement rounds have their own spending limits.

## Added during stage 1 (2026-11-09)

57. **Asking the customer:** a referral can list what the customer can send (the claim agent, or a handler from the claim page); the customer sees each request on their claim with its own upload, and the handler sees when it's sent. The hidden-instruction check never asks.
58. **Flight-delay claims:** a flight-status feed (a stand-in locally) finds flights on a customer's trip delayed past their plan's waiting time; the portal offers a one-tap claim carrying the feed's record, worked by the agent like any other.
59. **PayID payouts:** a customer adds an email, mobile number or ABN; payments record where they went, shown masked.
60. **Updates:** every status change worth telling (received, with a handler, declined, paid) and every request is written as an email and a text to an outbox, shown on the portal's Updates page.
61. **Saved claims:** a claim being filled in is saved on the server, without its receipts, and offered back to finish or discard.
62. **AI assurance console:** evaluations, improvement rounds, claim traces and the red team sit in their own app, behind a third sign-in issuer and audience for AI engineers; the handlers' workspace holds only claims work (decision 12).
63. **Demo home:** a local-only page that explains the project, shows live counts and links to the three apps; it reads no customer data and is never deployed.

