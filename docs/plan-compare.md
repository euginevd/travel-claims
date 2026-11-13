# Plan: Compare models

Spec items: TODO 1. Profile: prototype.

## Design

**What it answers.** *Which model should each agent run on?* An engineer runs the same claims on several models and efforts, sees each one's right decisions, cost, time and pass or fail side by side, and picks one. Today that's possible only by starting an improvement round and hoping the improver tries the right model.

**How others do it.** Two features, with two names:
- A *playground* (Langfuse, Braintrust, Bedrock) is a quick, unscored look at one prompt on a few models.
- *Experiments* (Braintrust, Langfuse) and model evaluation (Bedrock, Vertex AI) run a dataset through each setup and score it.
- Foundry compares models' features, metrics and cost side by side; Vertex judges two models head to head.

Ours scores claims to pick a model, so it is an experiment. It's named in the menu's plain words: **Compare**.

**The page, Evaluate · Compare** ([mockup](mockups/compare.html)), top to bottom, with little text:

1. **Pick.** A fact card for each model:
   - its price, speed, context and whether Australia offers it;
   - its effort levels as a small switch;
   - the one in use marked.

   Tick up to three.
2. **Run.** 5 claims, 25, or one claim; runs each (1 to 3, so the spread shows); the cost and time estimate; **Compare**.
3. **The answer**, in one line worked out in code: the cheapest model that meets the targets, and whether the others are clearly better or their ranges overlap.
4. **Right decisions against cost a claim.** One dot per model, cost on a log scale, with its likely range. The target is a dashed line and the area under it is shaded. Up and to the left is better.
5. **Better reasons, head to head.** The judge reads two models' explanations of the same claim, without knowing which model wrote which, and picks the better one. A grid shows each pair's win rate. This is steadier than a 0 to 3 grade.
6. **A card per model**:
   - right decision and its range;
   - one small bar per run, so a model that varies shows;
   - right amount, decided alone and declined;
   - cost, time and tokens a claim.

   Also on each card: its runs, and **Propose** (the one in use is marked instead).
7. **Decided differently.** A small box per claim: the handler's answer, and a coloured dot per model, ticked or showing what it decided instead.

**Use it.** **Propose** turns a card into a proposed version (model and effort changed, instructions kept) on Versions. A person approves it and the exam decides, as with an improver's proposal. Nothing on this page changes the live agent.

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
- A compared model is a configuration with status `compare`: never current, hidden from Versions.
- Each comparison is an ordinary practice run, so the scoreboard, run page, judge, spending limit and claim-by-claim diff all work unchanged.
- One claim is a run of size 1.

**Other agents (phase 3).** Screening, specialists, drafting (Wattle and letters), the judge, the improver and the Copilot read their model from environment settings today. Phase 3 moves each to a model setting engineers change from Agents, with a reason, recorded in the audit log. Each agent is compared on its own task:
- screening on the red-team receipts;
- drafting on the letters;
- the judge against handlers' grades.

**Leaves alone:** the exam (held-out claims stay for improvement rounds), the live agent's version, payouts.

## Security risks

- Spend: each comparison is up to three practice runs, which could run up cost. It is capped by the round spending limit per run and the daily budget, and the page shows the estimate before starting (as the practice run does today). R-cost.
- A compared configuration made live by mistake: it can't be. The `compare` status is refused by `set_current_version`, and only the Versions review makes a version current. Test it.
- Personal data: practice claims are made-up seed data; traces are masked as elsewhere. Unchanged.
- Who can use it: engineers only, as runs are today.

## Phases

### 1. Compare models on the practice set

- [x] One model registry shared by the api and the agent: ID, label, prices, speed, efforts, default effort, whether thinking is always on, and Bedrock availability.
  - Opus 5.5 and Fable 5.2 added, efforts up to `max`.
  - A refusal is recorded as *declined*.
  - Bedrock profiles found for Opus and Fable where Australia offers them.
- [x] `POST /api/engineering/compare`: up to 3 model and effort pairs, the size (`tiny` or `whole`) and runs each (1 to 3). It makes or reuses a `compare` configuration for each pair, starts the practice runs, and returns a comparison id.
- [x] `GET /api/engineering/compare/{id}`, all worked out in code from the runs:
  - each model's scores, its range and its spread across runs;
  - cost, time and tokens a claim;
  - pass or fail against the targets;
  - the one-line answer;
  - the claims decided differently.
- [x] The Compare page under Evaluate, between Scoreboard and Red team: the fact cards, the run bar, the answer, the cost chart, the model cards and the claim boxes.
- [x] `compare` configurations are hidden from Versions and refused as current.
- [x] Tests: the main path, the answer line's three cases (one cheapest pass, none pass, ranges overlap), and that a compared configuration can't be made current.

### 2. Head to head, one claim, and Propose

- [ ] The judge compares two models' explanations of the same claim, blind to which wrote which, in both orders so position doesn't count. The win rates fill the grid.
- [ ] One claim, a third choice beside 5 and 25: size-1 runs, shown in the same cards.
- [x] **Propose**: a proposed version from the card's model and effort, opened on Versions for review.
- [ ] Tests: the proposal is proposed, not in use; a win rate from known verdicts.

### 3. A model for each agent

- [ ] A model setting per agent (screening, specialists, drafting, judge, improver, Copilot). Each agent reads it at call time and falls back to its environment default. It is changed on the Agents page with a reason, recorded in the audit log.
- [ ] Compare tests each agent on its own task, as above.

## PR groups

1. Phases 1–2: Compare for the claim agent, one branch.
2. Phase 3: a model for each agent, its own branch.

## Ask first

None: no new AWS service, package or permission. Cost is the practice runs themselves. Haiku costs about $0.005 a claim on the last runs; Sonnet is about 20 times that, Opus 40 and Fable 80, so 5 claims on Fable is about $2 and 25 about $10. The page shows the estimate, Opus and Fable start at 5 claims, and the daily budget and per-run limit cap it.
