# Status

A worked example: `travel-claims`, in production. For a new project, replace it. The agent keeps it current in the same commit as each change.

## Built

1. `web`: claimants submit a claim with receipts and see its status (spec 9); handlers approve, decline or send back from the dashboard (spec 12).
2. `api`: claims, receipts and decisions, with authorisation on every request; payments checked against the policy limit in code (spec 13, 15).
3. `agent`: decides each claim and quotes the policy wording (spec 10), with receipt text kept apart from instructions (spec 17).
4. Infrastructure: `dev` and `prod` deployed through the `aws` workflow; Bedrock on the Australian inference profile (spec 16).

## Running it

5. Set up a machine once: `bash scripts/setup.sh`.
6. Run locally: `npm run dev` in `apps/web`, and `uv run fastapi dev` in `apps/api`.
7. Check: `AGENTS.md` → Commands.
8. Deploy: a merge to `main` applies to `dev` after approval; a manual `aws` run with target `prod` promotes it.

## Known gaps

9. Automatic payment under $1,000 (spec 11) runs in `dev` only; `prod` waits for the bank's API sign-off.
10. Decision logs are redacted, but not yet tested against real receipts (spec 18).
11. No `tflint` in the pipeline yet; Checkov and Trivy run on every PR.

## Next

12. Turn on automatic payment in `prod` once the bank signs off: `docs/plan-prod-payments.md`.
13. Add `tflint` to the pipeline.
