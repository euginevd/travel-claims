# Spec

`travel-claims`: UnderCover, an AI claims platform for a fictional travel insurer, rebuilt from the UnderCover project in Ed Donner's AI FDE course ([`week3day5-end`](https://github.com/ed-donner/undercover) is the reference for behaviour and data; the code is written fresh, with credit).

## Project

1. Problem: handlers work through a queue of travel claims by hand, so simple claims wait days to be paid (`business-context.md`).
2. Goal: an AI agent decides routine claims as accurately as a handler, so handlers spend their time only on claims that need judgement.
3. Users: customers make and track claims; handlers work the queue, and senior handlers sign off large payouts and can pause payouts; AI engineers evaluate, improve and red-team the agent.

## Stages

4. **Stage 1, local build and test (complete):** every app on a laptop with `docker compose up`, Claude through the Anthropic API, made-up data only.
5. **Stage 2, AWS build, test and deploy (in progress):** serverless in `ap-southeast-2` (decision 13): the front ends on S3 and CloudFront, `api`, `context` and `copilot` on Lambda, `agent` on AgentCore Runtime, PostgreSQL on Supabase in Singapore (made-up data only; real data needs Australia), with Cognito, Claude on Bedrock (Australian inference profile), Bedrock Guardrails and Secrets Manager; the pipeline deploys `dev` on merge and `prod` by hand. Planned in detail in 30–40. **Stage 3, enterprise (later, at work):** the same apps on EKS with Aurora PostgreSQL, GitOps and admission control (decision 6).

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
19. **Stage 2:** the pipeline deploys every app to AWS, every app passes its health check, claim data stays in Australia, and the threat model's controls are in place before the repo goes public.

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

## Stage 2 plan

Every stage 2 piece is switched on by a setting and off by default, so `docker compose up` keeps running stage 1 unchanged (decision 13).

30. **Front ends:** each web app is built by Vite into a private S3 bucket behind its own CloudFront distribution, which forwards only that app's api prefix (`/api/customer/`, `/api/staff/` and `/api/copilot/`, `/api/engineering/`) and adds the same security headers as its nginx today.
31. **`api`, `context` and `copilot`:** the existing images run on Lambda through the AWS Lambda Web Adapter, which does nothing outside Lambda, each with a function URL that only CloudFront (or the agent) calls. The `api` migrates and seeds on start, as in Docker.
32. **`agent`:** the existing image runs on AgentCore Runtime. It adds `/invocations` and `/ping` beside its routes: `/invocations` carries the api's request (route and body, with the agent's key) to the same route, and `/ping` says busy while a claim, run, round or red team is working, so a session lasts as long as its work. The api calls it with `invoke_agent_runtime` when `AGENT_RUNTIME_ARN` is set, and over HTTP otherwise. The copilot runs on Lambda, not Runtime, because the dashboard calls it with each handler's own token; AgentCore Gateway waits until a tool needs it.
33. **Database:** PostgreSQL on Supabase (`ap-southeast-1`, decision 13) through its session pooler, as `DATABASE_URL` and `CHECKPOINT_DATABASE_URL`; the Data API stays on with row-level security on every `public` table and no policies, so it serves nothing.
34. **Receipts:** a private, encrypted S3 bucket when `RECEIPTS_BUCKET` is set, under the same random names; the Docker volume otherwise.
35. **Sign-in:** three Cognito user pools (customers, staff, engineers), email and password only, each with its own app client and groups; the apps' existing issuer and audience settings point at them, and the web apps sign in to Cognito when `VITE_COGNITO_CLIENT_ID` is set. Test accounts are created by Terraform; in the demo, **Use test account** has the api sign one in through Cognito (`TEST_ACCOUNTS_SECRET`), so no password reaches the browser. The project page is a fourth CloudFront site, linking to the three apps.
36. **Models:** Claude on Bedrock when `MODEL_PROVIDER=bedrock` (model ids from settings, Australian inference profile), through the same Anthropic SDK; the Anthropic API otherwise. A Bedrock guardrail screens model calls.
37. **Secrets:** one JSON secret per environment under `travel-claims/`, read at start. Everything that can be is code: the apply generates the agent's key, records the agent's runtime ARN and leaves `SET-ME` placeholders for the two database URLs, which a person enters once; the model IDs are Terraform settings, not secrets. No secret value is in Terraform variables, images or state.
38. **Units** under `aws/`, applied in order by the pipeline: `registry` (ECR), `secrets`, `storage` (receipts), `identity` (Cognito and test accounts), `guardrail` (Bedrock), `functions` (the three Lambda functions), `agent` (Runtime), `web` (buckets and CloudFront). The bootstrap's deploy role grants only what these use.
39. **Images:** a workflow builds the `api`, `context`, `copilot` and `agent` images on merge and pushes them to ECR, tagged by commit; each unit deploys the tag it's given.
40. **Done when** each unit's PR shows its plan and cost comment, applies after approval, and spec 19 holds: every app answers its health check through CloudFront, and a claim is worked end to end on Bedrock.
