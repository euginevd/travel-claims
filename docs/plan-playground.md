# Plan: model playground

Spec items: TODO 1. Profile: prototype.

## Design

**What it answers.** *Which model should each agent run on?* An engineer runs the same claims on several models and efforts, sees each one's right decisions, cost, time and pass or fail side by side, and picks one. Today that's possible only by starting an improvement round and hoping the improver tries the right model.

**How others do it.**
- [LiteLLM](https://docs.litellm.ai/docs/proxy/model_compare_ui), [OpenLIT](https://docs.openlit.io/latest/openlit/prompts-experiments/openground/overview) and [Opper](https://opper.ai/compare-ai-models-side-by-side) put up to three or four models side by side on one prompt, with tokens, latency and cost.
- [Amazon Bedrock](https://docs.aws.eu/bedrock/latest/userguide/playgrounds.html) splits it in two: a compare-mode playground for quick looks, and [evaluation jobs](https://aws.amazon.com/bedrock/evaluations/) on your own dataset for the decision, read beside the playground's cost and latency.
- [QuickCompare](https://www.producthunt.com/products/quickcompare-by-trismik) runs your own data across chosen models.

The lesson: a single prompt shows style, but a model choice needs a scored set, and ideally more than one pass.

**Ours: two modes on one page, Evaluate · Playground, with little text: one line under the title, short labels, numbers over sentences.**

1. **Try one claim.** Pick a practice claim and up to three models or efforts. Each decides a copy side by side, showing its decision, payout, reason, model calls, tokens, cost and seconds, with the handler's answer beside them. Copies are never paid. This is the quick look.
2. **Compare on the practice set.** Pick up to three models or efforts and 5 or 25 claims. Each becomes a practice run on the current instructions. Results come back as square cards, one per model:
   - right decision with its likely range;
   - right amount and decided without a person;
   - the judge's grade;
   - cost and seconds a claim;
   - pass or fail against the gate's floors (`data/evals/gate.json`).

   Below them, a small square box for each claim they decided differently: the handler's answer, and which model missed. The cheapest model that passes is marked.
3. **Use it.** "Propose for the claim agent" turns a card into a proposed version (model and effort changed, instructions kept) on Versions, where a person approves it and the exam decides, exactly as an improver's proposal does. Nothing changes the live agent from the playground.

**The models it tests.** The current four, with every effort each takes. The agent today knows only the first three, and only low to high:

| Model | ID | $ per 1M in / out | Efforts | Note |
|---|---|---|---|---|
| Haiku 5.5 | `claude-haiku-5-5` | 0.10 / 0.50 | low to max, default medium | In use today |
| Sonnet 5.5 | `claude-sonnet-5-5` | 2 / 10 | low to max, default high | |
| Opus 5.5 | `claude-opus-5-5` | 4 / 20 | low to max, default medium | Thinking always on |
| Fable 5.2 | `claude-fable-5-2` | 8 / 40 | low to max; start at high | The most capable. Thinking always on; may decline (`refusal`); longer turns; needs 30-day data retention |

- **One list.** The models and their prices live in one registry the api and the agent share; it replaces `MODELS`, the agent's `PRICES` and the improver's three-model choice. Each model's efforts come from the list, and effort is always set explicitly, since the defaults differ by model.
- **A model that declines** (`stop_reason: "refusal"`) counts as no decision on that claim, shown as *declined*, not as an error, so a Fable card still scores.
- **Cost guard.** Fable costs about 80 times Haiku per token. The estimate is worked out from the last run's tokens per claim times each model's price:
  - it is shown before starting;
  - Opus and Fable start at 5 claims;
  - each run keeps the round spending limit and stops at it, marked *stopped at the limit*.
- **On AWS.** `dev` calls models through Bedrock's Australian inference profiles, found at deploy as Sonnet's and Haiku's are now. A model with no profile there shows as *Not offered in Australia* and can't be picked. Locally, through the Anthropic API, all four are offered.

**Built on what exists.**
- A playground model is a configuration with status `playground`: never current, hidden from Versions.
- Each comparison is an ordinary practice run, so the scoreboard, run page, judge, spending limit and claim-by-claim diff all work unchanged.
- One claim is a run of size 1.

**Other agents (phase 3).** Screening, specialists, drafting (Wattle and letters), the judge, the improver and the Copilot read their model from environment settings today. Phase 3 moves each to a model setting engineers change from Agents, with a reason, recorded in the audit log. Each agent is tested in the playground on its own task:
- screening on the red-team receipts;
- drafting on the letters;
- the judge against handlers' grades.

**Leaves alone:** the exam (held-out claims stay for improvement rounds), the live agent's version, payouts.

## Security risks

- Spend: each comparison is up to three practice runs, which could run up cost. It is capped by the round spending limit per run and the daily budget, and the page shows the estimate before starting (as the practice run does today). R-cost.
- A playground configuration made live by mistake: it can't be. The `playground` status is refused by `set_current_version`, and only the Versions review makes a version current. Test it.
- Personal data: practice claims are made-up seed data; traces are masked as elsewhere. Unchanged.
- Who can use it: engineers only, as runs are today.

## Phases

### 1. Compare models on the practice set

- [ ] One model registry (ID, label, prices, efforts, default effort, thinking always on or not) shared by the api and the agent:
  - Opus 5.5 and Fable 5.2 added;
  - efforts up to `max`;
  - a refusal recorded as *declined*;
  - Bedrock profiles found for Opus and Fable where Australia offers them.
- [ ] `POST /api/engineering/playground/compare`: up to 3 model and effort pairs, size `tiny` or `whole`. It makes or reuses a `playground` configuration for each pair, starts a practice run per pair, and returns the run ids.
- [ ] `GET /api/engineering/playground`: recent comparisons, each with its runs' scores, cost, seconds and pass or fail against the gate floors.
- [ ] The Playground page under Evaluate, between Scoreboard and Red team:
  - choose models and efforts, and the claim count with an estimated cost;
  - a card per model; the cheapest that passes is marked;
  - the claims decided differently.
- [ ] `playground` configurations are hidden from Versions and refused as current.
- [ ] Tests: the main path, and that a playground configuration can't be made current.

### 2. One claim, side by side, and Use it

- [ ] One claim, a third choice beside 5 and 25 claims: size-1 runs, shown in the same cards, with the handler's answer.
- [ ] "Propose for the claim agent": a proposed version from the card's model and effort, opened on Versions for review.
- [ ] Tests: the proposal appears on Versions as proposed, not in use.

### 3. A model for each agent

- [ ] A model setting per agent (screening, specialists, drafting, judge, improver, Copilot). Each agent reads it at call time and falls back to its environment default. Changed on the Agents page with a reason, and logged in the audit log.
- [ ] The playground tests each agent on its own task, as above.

## PR groups

1. Phases 1–2: the claim agent's playground, one branch.
2. Phase 3: a model for each agent, its own branch.

## Ask first

None: no new AWS service, package or permission. Cost is the practice runs themselves. Haiku costs about $0.005 a claim on the last runs; Sonnet is about 20 times that, Opus 40 and Fable 80, so 5 claims on Fable is about $2 and 25 about $10. The page shows the estimate, Opus and Fable start at 5 claims, and the daily budget and per-run limit cap it.
