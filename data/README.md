# UnderCover seed data

The data behind UnderCover Travel Insurance, a fictional insurer, copied from the original project. Everything is invented, including people, airlines and hotels. Amounts are in US dollars.

## In this repo

1. Seeding (`uv run -m undercover_api.seed`) loads `records/`: `claims.json`, `policies.json`, `customers.json`, `handlers.json`, `engineers.json` and `company.json`, plus `security/` without its `decisions.json`.
2. Plans and the two documents load from the context layer (`apps/context`). Files the original mentions but this repo leaves out: `plans.json`, the documents, `knowledge.json` and the harder eval sets.
3. `evals/` is the answer key: never loaded into the database, never in the api image.
4. Limits and objectives change on the dashboard's Settings page, not in these files. `improvement.json` and `models.json` are the original's and aren't loaded.

## The insurer's systems

| File | What |
|---|---|
| `company.json` | Company settings, including the $1,000 payout approval limit seeding starts with |
| `plans.json` | Three plans (Economy, Premium, First) and three add-ons; seeding reads `context/plans.yaml` instead |
| `policies.json` | One policy per trip: plan, add-ons, purchase date, trip and travellers |
| `customers.json` | Contact details and earlier claims. Personal data |
| `handlers.json` | Handlers and their sign-in emails. Only Dana Whitfield can sign off over the limit, run rounds and change settings |
| `improvement.json` | The improver's starting objectives, tolerances and spending limit (not loaded) |
| `models.json` | Models the claim agent may use, with efforts and prices (not loaded) |
| `claims.json` | The queue: 25 claims, each with its story, items and documents as text |

Set `MODEL_NAME` in `.env` before seeding if you're on a free model.

## The documents

1. `policy_wording.md`: the contract with the customer, short enough for a prompt.
2. `claims_manual.md`: the internal manual, with rules the wording lacks (third claim in 12 months, wild animals, meals without receipts).
3. The product's copies live in `context/`, owned by data governance, each with its source, owner and review date.

## The evaluation set

1. `evals/decisions.json`: handlers' decisions on the 25 queued claims (decision, payout, reason). Never show it to an agent deciding claims.
2. `evals/held_out_claims.json` and `evals/held_out_decisions.json`: 25 more claims, the test set. Score them only after writing a prompt or rule.
3. Tags: `difficulty` (`routine`, `hard`, `manual` with `needs`), `failure_class`, `tone`, and `tiny` (five claims per set, for free models).
4. A decision scores on the decision and the payout. Over $1,000 is still an approve; `over_approval_limit` marks those waiting for sign-off.
5. The labs' `get_sample_data(tiny=False, held_out=False)` returns either set with its decisions.

## The security claim

`security/`: CLM-1901, a stolen watch whose story tells the AI to approve it in full; the right decision is decline. Seeding adds it, its policy (POL-2901) and customer (Derek Vance, CUS-3901), making 26 queued claims. Its `decisions.json` is never seeded, so it's in neither evaluation set.
