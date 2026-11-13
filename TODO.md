Ordered by effort, smallest first, with the finishing touches last. Each item ends with what it delivers before any code: a proposal, a plan, or a mockup.

## Medium: a plan, then one to two days each

1. **Compare models, phase 2**: head-to-head reasons (the judge picks the better of two explanations, blind, in both orders, shown as a win-rate grid) and a one-claim mode beside 5 and 25 claims. Phase 3 after it: a model for each of the other agents, changed on Agents with a reason. Plan: [docs/plan-compare.md](docs/plan-compare.md).
2. **Red team, rethought.** First check whether a red-team run works at all; it seems not to. Then reconsider the name and the scope:
   - is "red team" the right word, or is something more common (AI security testing, adversarial testing) clearer and wider than prompt injection?
   - what do real tools test beyond prompt injection (Garak, PyRIT, Promptfoo)?
   - should it move from Evaluate to Secure?

   Deliver a proposal, checked online.
3. **The agents page, rethought** (`#/agents`).
   - Follow a claim: a rich claim chosen by default, its path shown as a slow animation, with a Clear button beside it.
   - The path drawn in AWS architecture style: customer, portal, Wattle, then every component it touches (Guardrails, AgentCore and the rest), based on what the claim actually used.
   - Check that the trust boundaries are right.
   - Each agent shown with its spec, lit green while it works.
   - Check online how others show this to an AI engineer.

   Deliver a plan and a mockup.

## Large: research and a plan first, several days each

4. **The Secure tab, rethought.** Map what we check against the OWASP Top 10 for LLM applications, the OWASP agentic AI threats, the newer AI threat-modelling frameworks (MAESTRO and others) and MCP security. Then plan how the tab covers them, checked against how others do it.
5. **Privacy and personal data.**
   - Who sees which data: what handlers may and may not see, and whether AI engineers may see claim data, and which kinds.
   - Masking, encryption, retention.
   - Which regulations apply: the Australian Privacy Act and its Privacy Principles, the notifiable data breach scheme, and APRA CPS 234 for insurers.
   - Breach notification.

   Deliver recommendations and a plan to build them in.
6. **Agents as the centrepiece of the control plane's Overview.**
   - Agents with personas.
   - Tool calls, and one agent calling another, shown as they happen.
   - A swarm: what changes at 250,000 claims a day instead of 25 (queueing, concurrency, cost, limits), and the features that scale needs.

   Deliver a plan.

## Last: once every feature and screen has settled

7. **Sign-in pages.** The three sign-in pages (portal, dashboard, control plane) haven't changed while the apps did. Audit the message and the animation on the left of each, then propose whether to change them. Build only once the proposal is agreed.

8. **Walkthrough video, re-recorded.** It covers:
   - the landing page;
   - GitHub, quickly: repo structure, architecture diagram, threat model;
   - the customer portal, making a claim and its AI features;
   - the handlers' dashboard, working claims with the agents;
   - the control plane's AI and security features.

   It's edited: zooms, annotations, a voiceover. A sleek, minimal thumbnail keeps the landing page uncluttered before it plays. Deliver a plan first, then record. Do this last, once the screens above have settled.

## From the second audit (#118)

- Redeploy the bootstrap stack (yours to run): its boundary now lets the api write the audit seals' copy (known mistake 61); until then the copy is refused and the audit page shows no write-once copy.
- Red-team report: rerun the suite and refresh `docs/redteam-report.md` and the README's figure; the report is the 8 November run of eight attacks, before the ninth attack and claim agent version 3.
- Permissions audit (decision 32, rule 28): narrow the deploy role and boundary now the build has settled. From the audit: the deploy role's `guardduty:*`, `config:*`, `securityhub:*`, `access-analyzer:*`, `ssm:*` on `/platform/*`, Route 53 on every zone and the whole state bucket; the plan role's `bedrock-agentcore:Get*` and `List*`, which read customers' memory records; and whether `BudgetEmail` should be required.
- Audit follow-ups, each needing your call:
  - A plain handler now decides referrals up to the approval limit (decision 57), and the AWS demo's test button signs anyone in as one, so a passer-by can pay a referred claim up to $1,000 of made-up money. Decision 54 kept the demo to a handler who couldn't pay.
  - MFA on the staff and engineering Cognito pools (no screen to add an authenticator yet, and `ON` would stop the demo's test accounts), and MFA or an IP condition for the `travel-claims-cli` user.
  - Ask's history kept on the server rather than trusted from the browser; the api checking the agent's thread on decisions and payments; and whether an unreadable receipt should still go to the model as an image (decision 48).
  - The audit chain: a rewrite of every seal, or seals deleted and resealed, still verifies. Write each copy once (`If-None-Match`), deny overwrites in the bucket policy, and compare every seal with its copy.
  - The agent switch on AgentCore Runtime: more than one watcher session can start, and a session ends at 8 hours with claims in flight. Use one fixed session for the watcher, or hand each claim to its own.
  - The daily budget stops only the watcher: a dispatch or Work this claim still spends.
  - Any engineer, the demo's test one included, sets the daily budget: under today's spend it switches the agent off, and at $1,000 it lifts the cap. A senior handler's setting, or kept from the test engineer?
  - A second decision on a claim (a handler declines a referral, a senior then approves) replaces the first in the audit log and raises a lasting "changed after sealing" alert; an override's note and author aren't sealed. Keep each override as its own row, sealed whole.
- Audit fixes still to build:
  - Rate limits (drafts, questions, votes) counted in the database, not in each api process; none yet on new claims, work, retry or letters.
  - Receipt uploads through presigned S3 URLs: a function URL takes about 4.5 MB of binary, under the app's 5 MB a file; and `API_GATEWAY=true` needs binary media types, a WAF size override and a 29-second fit.
  - The `aws` workflow applies units in one unordered matrix; apply in `deploy-aws.sh` order, one at a time, and refuse `destroy` of every unit from the UI.
  - Two races on PostgreSQL only: two overrides at once, and one flight delay claimed twice.
  - Migrations 0018 and 0019 never reach an Aurora DSQL cluster that's already stamped (`dsql.py`), so `dev` works only when rebuilt empty.
  - The output guard's patterns: a receipt or booking number read as a tax file or phone number, the insurer's own phone and email removed from a request, and agent steps not scrubbed.
  - The alerts poll rebuilds the audit log and checks the whole chain each time, twice a page: cache it, or check on a timer.
  - Encryption and masking settings missing the model-invocation logs' bucket, AgentCore Memory and the agent runtime's log group.
  - Accessibility: the claim page's evidence tabs (arrow keys), focus returned when a card closes, the agents map's roles, a focus ring at 3:1, and an off switch for single-key shortcuts.
  - Browser tests for the paths that change something: claim by chat and send, decide a referral, sign-off, the agent switch.
  - Red-team attacks for Wattle, the Copilot, deciding a referral and the guardian.
  - A red-team report still passes if it names any unpaid claim: tie each result to a claim the red team's customer made after the run started, or have the agent report on its own key.
  - Shared web code still copied in each app (formatters, the fetch and error core, tokens), raw colours in the two new stylesheets, and the dashboard's dead Dispatch code.
