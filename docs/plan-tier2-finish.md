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

- [x] `identity` adds the red team's customer, Derek Vance (`customers` pool), like the other test accounts, without a stored password.
- [x] The api's tier 2 test sign-in (`TEST_SIGN_IN`) also signs in `attacker`, through Cognito as for Oliver; still refused unless `TEST_SIGN_IN` is on.
- [x] ~~The runner takes per-site URLs~~: not needed. The console starts the suite in the agent, which reaches the api's own URL, every audience's routes included.
- [x] Run all eight attacks against `dev` (2026-11-10: 8 of 8 held, all referred, $0 paid): every attack holds, nothing paid beyond what each claim supports; the report shows on the console's Red team page. Tests: sign-in refused with `TEST_SIGN_IN` off; runner URLs per audience.

## Phase 2: the guardrail, checked and on

Today the guardrail is named in headers on every Bedrock call, so it screens each turn's whole context: the agent's own tool results and, worse, the receipts the hidden-instruction check must read in order to flag them. That risks blocking the check (spec 36) and bills every turn (see Costs).

- [x] Screen only what comes from outside, through `ApplyGuardrail` (input only, `guardrail.py`), inside the agent's one screening step: the claim's text and every Ask UnderCover and engineers' question. Receipts' images stay with the hidden-instruction check. The Copilot's input is a signed-in handler's, so it isn't screened. The per-call headers are gone.
- [x] A guardrail block counts as instructions found: the claim is referred (never declined) and its screening step and decision say so; a question gets the existing refusal. Its fires count with the screening check's on the Threat coverage page.
- [x] Fail closed: if the guardrail can't be reached, the claim is referred and a question refused.
- [x] Set `enabled` (#58), then checked live on `dev` (2026-11-10: tiny claims 5 of 5, CLM-1901 referred, red team 8 of 8): the eight red-team attacks still end referred or declined with nothing paid, CLM-1901 is still caught, and the five tiny claims still match the handlers.

## Phase 3: AgentCore Gateway in front of the context layer

Revised 2026-11-10. Only the context layer goes through Gateway now. The api's agent routes are scoped to one claim, and today the agent's code fills in the claim, never the model (R3); as Gateway tools the model would choose the claim, so they wait for phase 5, which needs a claim-scoped design anyway (a Gateway interceptor or a per-claim token). With nothing for the agent to hold, Identity waits too: inbound is the Runtime's role, outbound Gateway's own.

- [x] In the `agent` unit (units apply in parallel, and the gateway serves only the agent): an AgentCore Gateway (MCP, `AWS_IAM` inbound) and one MCP server target, `context`, at the context's function URL, which Gateway signs with its own role for the `lambda` service; the role has the project boundary and may call only the context.
- [x] The context's function URL then answers only Gateway's role: the agent's role loses `lambda:InvokeFunctionUrl` on it and gains `bedrock-agentcore:InvokeGateway` on this gateway alone (known mistake 26).
- [x] The agent reaches the context through the gateway's URL, signing for `bedrock-agentcore`, and names its tools as Gateway does (`context___get_claim_rules`) through a setting; it takes results whether Gateway passes structured content or text. Tier 1 is unchanged: no prefix, the context's own URL.
- [x] Tests: the signer's service, the tool prefix, both result forms; a claim worked on `dev` through the gateway, and the red team again.

## Phase 4: AgentCore Memory and a Knowledge Base

Built 2026-11-10, in the `agent` unit beside the gateway (units apply in parallel). Wattle AI's conversations stay in Postgres: they're per handler and short-lived, and moving them adds no control.

- [x] `aws_bedrockagentcore_memory` with no strategy: the agent writes one record per decided claim itself (`BatchCreateMemoryRecords`) under `customers/<id>/` (ended with `/`, and only records in exactly that namespace kept, in case the filter matches by prefix) with the claim ID as metadata, and lists one customer's (`ListMemoryRecords`), keeping the latest per claim and leaving out the current one. Same rules as R20; no model extracts anything. `MEMORY_ID` set: AgentCore; unset: Postgres. Memory only informs, so if it can't be reached it recalls nothing and a decision goes on.
- [x] A Bedrock Knowledge Base on S3 Vectors (Titan Text Embeddings V2, 1024 dimensions) over the policy wording only, one document per section with its number and title as metadata (`data/knowledge`, made by `uv run -m undercover_context.knowledge`, checked by a test), no chunking, ingested by the apply when a file changes (the `aws` workflow plans the `agent` unit for a change in `data/knowledge/`; the apply starts the ingestion and doesn't wait for it). Ask UnderCover's wording search uses it when `KNOWLEDGE_BASE_ID` is set, citing sections as before, and falls back to the context layer's word search if it can't be reached. The claim agent keeps the context layer's search, which also covers the claims manual.
- [x] Bootstrap: the boundary gains Memory's two record actions, `bedrock:Retrieve`, Titan's embedding and the knowledge stores; the deploy role creates knowledge bases, S3 Vectors and passes the knowledge role to Bedrock; the plan role reads them.
- [ ] Live on `dev` after the bootstrap update: a claim remembered and recalled for a returning customer, an Ask UnderCover answer citing a section from the Knowledge Base, and the red team.

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
| Gateway | $0.005 per 1,000 tool calls (each lookup is a few: initialize, list, call) | under $0.05 |
| Identity | not needed until phase 5 | $0 |
| Memory | $0.75 per 1,000 long-term records a month, $0.50 per 1,000 retrievals, short-term by the GB | about $0.40 |
| Knowledge Base on S3 Vectors | vectors $0.06/GB-month, queries $2.50 a million, embeddings fractions of a cent; KB retrieval up to $1 per 1,000 | under $0.50 |
| Code Interpreter | $0.0895 per vCPU-hour while code runs, seconds a claim | under $0.10, less Claude tokens saved |
| **Added** | | **about $2–3 a month; about $0.05 idle** |

`dev` stays well under its $20 budget. Building and testing all five phases should cost about $3–5 of Claude. On the Anthropic key, Claude's tokens come out of existing credits at the same prices as Bedrock, so the AWS bill is only the table above plus about $2 idle (Lambda, Runtime, S3, CloudFront, Secrets Manager); Titan embeddings for the Knowledge Base stay on Bedrock, fractions of a cent.

## PR groups

0. Phase 0: the switch and the database fix.
1. Phases 1 and 2: red team on AWS and the guardrail.
2. Phase 3: Gateway in front of the context layer.
3. Phase 4: Memory and the Knowledge Base, with one bootstrap update.
4. Phase 5: code execution.
