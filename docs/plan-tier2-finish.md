# Plan: finish tier 2

Status items 44–46: the red team on AWS, the Bedrock guardrail checked live and switched on, and the rest of AgentCore (Gateway, Identity, Memory, a Knowledge Base on S3 Vectors) with code execution through Code Interpreter. Each new piece sits behind a setting, off by default, so tier 1 keeps its local path (spec 5). The custom domain waits.

## Which Claude on AWS: a switch, Anthropic API first

Decided 2026-11-10: `dev` on AWS uses our own Anthropic API key first (the account has credits), and switches to Bedrock once everything works. Only Claude's calls switch: the guardrail, Gateway, Identity, Memory and the Knowledge Base are AWS services either way, so they cost the same whichever Claude answers.

- **For the key:** the tokens, the main cost, come out of existing credits; the same key and spend limit as tier 1; no Bedrock model-access steps.
- **Against:** claim data leaves Australia (made up in `dev`, so acceptable there); a long-lived key on AWS, kept in the app secret, never in an environment variable (code-standards 10); token cost leaves AWS Budgets.
- **Spec 26 change, for approval:** "Tier 1, and tier 2's `dev` while `MODEL_PROVIDER` is `anthropic`, send only made-up data to the Anthropic API; `prod` sends claim data only to Bedrock in Australia." Decision 15 records it; decision 3 stays for `prod`.

## Phase 0: the switch, and the agent's database error

The first claim worked on AWS (CLM-1001, 2026-11-10) stopped with `OperationalError`: a PostgreSQL connection error in the agent on Runtime, whichever Claude answers.

- [ ] Find the cause in the agent's Runtime log (the traceback is logged), fix it at its cause, with a test. Likely suspects: a pooled connection the Supabase pooler closed while the session idled, or the checkpointer's pipelined writes through the transaction pooler.
- [ ] A repository variable `MODEL_PROVIDER` (`anthropic` or `bedrock`, default `bedrock`) sets the `agent` and `functions` units' `MODEL_PROVIDER` and model IDs: plain names (`claude-sonnet-5-5`) for the API, the Australian profiles for Bedrock, whose precondition applies only then.
- [ ] `fill-secret.py` adds `SET-ME` placeholders for `ANTHROPIC_API_KEY` and `ANTHROPIC_WORKSPACE_ID`, which a person fills in the console, as for the database URLs.
- [ ] The agent's one model module names a configuration's model as its provider does: a Bedrock ID becomes its plain name on the API, and a plain name (as the improver proposes) becomes its configured Bedrock profile on Bedrock. That fixes improved versions on Bedrock today, too. Tests both ways.
- [ ] Work CLM-1001 on `dev` end to end on the API; later, the same on Bedrock by changing the variable.

## Phase 1: the red team on AWS

The suite signs in through the local stand-in's `dev/*-sign-in` routes, and its one `UNDERCOVER_API` reaches every audience; on AWS each audience is its own CloudFront site.

- [ ] `identity` adds the red team's customer, Derek Vance (`customers` pool), like the other test accounts, without a stored password.
- [ ] The api's tier 2 test sign-in (`TEST_SIGN_IN`) also signs in `attacker`, through Cognito as for Oliver; still refused unless `TEST_SIGN_IN` is on.
- [ ] The runner takes `PORTAL_URL`, `DASHBOARD_URL` and `CONSOLE_URL` (each falling back to `UNDERCOVER_API`), so it reaches each audience through its own site.
- [ ] Run all eight attacks against `dev`: every attack holds, nothing paid beyond what each claim supports; the report shows on the console's Red team page. Tests: sign-in refused with `TEST_SIGN_IN` off; runner URLs per audience.

## Phase 2: the guardrail, checked and on

Today the guardrail is named in headers on every Bedrock call, so it screens each turn's whole context: the agent's own tool results and, worse, the receipts the hidden-instruction check must read in order to flag them. That risks blocking the check (spec 36) and bills every turn (see Costs).

- [ ] Screen only what comes from outside: the claim's text and receipts' text before the hidden-instruction check, and each Ask UnderCover, Copilot and Wattle question, through `ApplyGuardrail` (input only) in each app's one model module. Drop the per-call headers.
- [ ] A guardrail block refers the claim for a handler (never declines it) and is recorded as a step; a blocked chat question gets a plain refusal. Its fires feed the Threat coverage page's guardrail counts.
- [ ] Fail closed: if the guardrail can't be reached, refer the claim.
- [ ] Check live on `dev`, then set `enabled`: the eight red-team attacks still end referred or declined with nothing paid, CLM-1901 is still caught, and the five tiny claims still match the handlers.

## Phase 3: AgentCore Gateway and Identity

- [ ] New unit `gateway`: an AgentCore Gateway with two MCP targets: the context layer (its seven lookups) and the api's agent routes for one claim. The agent reaches both as MCP tools through the Gateway, signed with its Runtime role (IAM, inbound); Identity holds the outbound credential to the api (the agent's key), so it leaves the agent's environment. Free through Runtime and Gateway.
- [ ] The context layer's function URL becomes reachable only by the Gateway's role (known mistake 26).
- [ ] `GATEWAY_URL` set: tools through the Gateway; unset: the direct path as now. Tests: the tool list is the same either way; a claim id from the model can't reach another claim (R3).
- [ ] A claim worked end to end on `dev` through the Gateway.

## Phase 4: AgentCore Memory and a Knowledge Base

- [ ] New unit `memory`: an AgentCore Memory with one namespace per customer, for the agent's `search_memory` (instead of the Postgres store) and Wattle AI's conversations. Same rules as R20: only claim facts and decisions, never the customer's words, nothing from a referred claim or an evaluation. `MEMORY_ID` set: AgentCore; unset: Postgres.
- [ ] New unit `knowledge`: a Bedrock Knowledge Base on an S3 Vectors index over the policy wording only (never the claims manual), Titan Text Embeddings V2, synced by the apply. Ask UnderCover and the agent's policy checks retrieve from it when `KNOWLEDGE_BASE_ID` is set; the context layer's lookup otherwise. Each answer still names its source.
- [ ] Tests: one customer's memory never comes back for another; a retrieval cites the wording section it came from.

## Phase 5: code execution with MCP

The agent writes one short program that calls the Gateway's tools as a code API; AgentCore Code Interpreter runs it and only the result returns to Claude, instead of one model turn per tool call.

- [ ] Threat model first: R23, a receipt's hidden instruction steers the program the model writes. Controls: the sandbox reaches only the Gateway (no internet), the Gateway's tools are the agent's own read and decision routes for one claim, so payments and limits stay in the api's code (decision 4); time, memory and output limits; every program and its result recorded as a step.
- [ ] `CODE_EXECUTION=true` turns it on; off, the agent calls tools one turn at a time. Evaluated on the tiny sets both ways: kept only if accuracy holds and tokens per claim drop.

## Security

- Threat model: R22 gains the AWS run; R23 (model-written code) is new; R20 moves to AgentCore Memory; R8 changes if the Anthropic key is used in `dev`. The data flow adds the Gateway, Memory, the Knowledge Base and Code Interpreter.
- New permissions in the bootstrap's deploy role: Gateway, Memory, Code Interpreter, Knowledge Bases and S3 Vectors. Each unit's IAM role keeps the `travel-claims-boundary` boundary.
- No new packages expected beyond `bedrock-agentcore` (checked and pinned per rule 18 when added).

## Costs

AWS list prices, November 2026; monthly, at demo volume (about 100 claims, 200 chat questions, four red-team runs, a few tiny evaluations). Claude tokens stay the main cost: about $0.02–0.04 a claim on Sonnet, $0.002 on v3 (Haiku).

| Piece | How it's billed | Estimate a month |
|---|---|---|
| Red team on AWS | Claude tokens and Runtime time for 8 attacks, about $0.30 a run | about $1.20 |
| Guardrail, screening only outside text | $0.15 per 1,000 text units (1,000 characters), a few units a claim | under $0.10 |
| *Guardrail as wired now, every call* | *the whole context every turn, about 120 units a claim* | *about $2–3* |
| Gateway | $0.005 per 1,000 tool calls; tool indexing $0.02 per 100 tools | under $0.05 |
| Identity | free through Runtime and Gateway | $0 |
| Memory | $0.75 per 1,000 long-term records a month, $0.50 per 1,000 retrievals, short-term by the GB | about $0.40 |
| Knowledge Base on S3 Vectors | vectors $0.06/GB-month, queries $2.50 a million, embeddings fractions of a cent; KB retrieval up to $1 per 1,000 | under $0.50 |
| Code Interpreter | $0.0895 per vCPU-hour while code runs, seconds a claim | under $0.10, less Claude tokens saved |
| **Added** | | **about $2–3 a month; about $0.05 idle** |

`dev` stays well under its $20 budget. Building and testing all five phases should cost about $3–5 of Claude. On the Anthropic key, Claude's tokens come out of existing credits at the same prices as Bedrock, so the AWS bill is only the table above plus about $2 idle (Lambda, Runtime, S3, CloudFront, Secrets Manager); Titan embeddings for the Knowledge Base stay on Bedrock, fractions of a cent.

## PR groups

0. Phase 0: the switch and the database fix.
1. Phases 1 and 2: red team on AWS and the guardrail.
2. Phase 3: Gateway and Identity.
3. Phase 4: Memory and the Knowledge Base.
4. Phase 5: code execution.
