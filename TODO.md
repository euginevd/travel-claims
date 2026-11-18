Ordered by value for the time it takes: the most value for the least time first. *Your call* marks a decision to make before building.

## Now: high value, a day or less

1. **Redeploy the bootstrap stack** (yours to run). Until then the audit seals' write-once copy is refused (known mistake 61).
2. **Migrations 0018 and 0019 on Aurora DSQL.** They never reach a cluster that's already stamped (`dsql.py`), so `dev` works only when rebuilt empty.
3. **The daily budget stops only the watcher.** A dispatch or Work this claim still spends.
4. **Red-team results tied to their own claims.** A report still passes if it names any unpaid claim.
5. **The `aws` workflow in order.** Apply units in `deploy-aws.sh` order, one at a time, and refuse `destroy` of every unit.
6. **Missing encryption and masking settings** for the model-invocation logs' bucket, AgentCore Memory and the agent runtime's log group.

## Next: high value, one to three days

7. **Audit chain.** Rewritten seals still verify. Write each copy once (`If-None-Match`), deny overwrites, and compare every seal with its copy. Keep each override as its own sealed row, so a second decision doesn't replace the first.
8. **A red-team run on `dev`**, where the Bedrock guardrail runs first, once `dev` is deployed again. The Copilot attack (RT-19) needs the agent to reach the Copilot there (`COPILOT_URL`, signed for its IAM-only URL).
9. **Server-side trust.** Keep Ask's history on the server, and have the api check the agent's thread on decisions and payments. *Your call*: should an unreadable receipt still reach the model as an image (decision 48)?
10. **The AgentCore watcher.** More than one session can start, and a session ends at 8 hours. Use one fixed session, or give each claim its own.
11. **Permissions audit** (decision 32, rule 28). Narrow the deploy role and the boundary:
    - the deploy role: `guardduty:*`, `config:*`, `securityhub:*`, `access-analyzer:*`, `ssm:*` on `/platform/*`, every Route 53 zone and the whole state bucket
    - the plan role's `bedrock-agentcore:Get*` and `List*`

    *Your call*: should `BudgetEmail` be required?
12. **Receipt uploads through presigned S3 URLs.** A function URL takes only about 4.5 MB, under the 5 MB limit.
13. **Rate limits in the database.** Today each api process counts its own. Add limits on new claims, work, retry and letters.

14. **Red team, step 4.** RT-23 to RT-26 were all stopped by the instruction check. Add versions with nothing for it to spot, so memory, the guardian's model-call rule, the documents specialist and each claim's scoped tools face an attack.

## Then: worth it, smaller payoff

15. **Output guard patterns.** Receipt and booking numbers are read as tax file or phone numbers, the insurer's own contacts are removed, and agent steps aren't scrubbed.
16. **Alerts poll.** It rebuilds and checks the whole audit chain twice a page: cache it, or check on a timer.
17. **Two races on PostgreSQL**: two overrides at once, and one flight delay claimed twice.
18. **Compare models, phase 3.** Choose a model for each of the other agents ([plan](docs/plan-compare.md)).
19. **Browser tests** for claiming by chat, deciding a referral, sign-off and the agent switch.
20. **MFA** on the staff and engineering pools, and MFA or an IP condition for `travel-claims-cli`. It needs a screen to add an authenticator, and `ON` stops the demo's test accounts.
21. **Shared web code.** Move the copied formatters, fetch core and tokens into `web-core`, replace raw colours in the two new stylesheets, and delete the dashboard's dead Dispatch code.

## Large: research and a plan first, several days each

22. **Privacy and personal data.**
    - who sees which data
    - masking, encryption and retention
    - breach notification
    - the Privacy Act, the notifiable data breach scheme and APRA CPS 234

    Delivers recommendations and a plan.
