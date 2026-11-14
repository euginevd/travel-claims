# Features

The agreed features, by app, numbered so reviews can cite them (features 12). New requirements and known gaps start in [TODO.md](../TODO.md); the rules every feature keeps are in [spec.md](spec.md). PR is the pull request that first built it.

| App | For | Link (locally) |
|---|---|---|
| [Project page](#project-page-home) | Anyone looking at the project | http://127.0.0.1:5172 |
| [Customer portal](#customer-portal-portal) | Customers (Oliver Grant) | http://127.0.0.1:5173 |
| [Handlers' dashboard](#handlers-dashboard-dashboard) | Handlers and senior handlers (Marcus, Dana Whitfield) | http://127.0.0.1:5174 |
| [AI control plane](#ai-control-plane-console) | AI engineers (Sam Carter) | http://127.0.0.1:5175 |

Each app has its own sign-in, a **Use test account** button, the Canopy design (#71, #72) and a **← Project** link.

## Project page (`home`)

| # | Feature | Status | PR |
|---|---|---|---|
| 1 | A short brief, the three-minute captioned walkthrough video and a link to each app and the code | Done | #38 |

## Customer portal (`portal`)

| # | Feature | Status | PR |
|---|---|---|---|
| 2 | **Claims** (side panel): the customer's own claims, in progress then done, three then five more a tap, and on a big screen the list beside the claim; each titled by its kind and trip with the customer's words under it; each opens to where it stands, its claim number, a tracker, what we need and, once decided, the reason (an approval in plain words) | Done | #37, #113 |
| 3 | **Make a claim by chat**, one question at a time, asking only what the records can't say, with up to five photos or files (unreadable ones refused or referred to a person). The trip is shown with *change*; the check card is edited in place; nothing is sent until the customer taps Send claim; saved to finish later | Done | #5, #113 |
| 4 | **Just tell Wattle**: typing trouble starts a claim, and the drafting assistant fills it in from the customer's words and files | Done | #71, #113 |
| 5 | Receipts in another currency converted to US dollars, the original kept and marked to check (spec 28) | Done | #72 |
| 6 | One-tap delayed-flight claims when the flight-status feed shows the flight qualifies | Done | #37 |
| 7 | A tracker per claim with a plain reason and AI disclosure; upload asked-for documents, ask for a person's review, get paid to a PayID | Done | #37 |
| 8 | **Messages** (side panel): every email and text, an email and its text as one, the newest three, then five more on each tap, a dot for anything new | Done | #37, #113 |
| 9 | **Wattle AI**: answers about the customer's cover or claim, citing the policy: a headline, up to three sourced points and one next question. The engineers' Wattle can put two agent versions side by side and lists what it read before answering | Done | #39, #113 |
| 10 | Thumbs up or down, with a comment, on Wattle's answers and each decision's explanation (spec 21) | Done | #72 |
| 10a | **Chat-first portal**: Wattle is the home screen: a greeting, one dismissable news line, three suggestions and **At a glance** (claims, cover, getting paid), all from the customer's records. Wattle's answer names what to show and never changes anything (decision 53). **Home** returns to the start screen with the chat kept, and **New chat** in the composer clears it; **Settings** holds PayID, mobile and texts. Cover answers say *General information only; your policy wording decides* | Done | #113 |

## Handlers' dashboard (`dashboard`)

| # | Feature | Status | PR |
|---|---|---|---|
| 11 | **Today** (home): Wattle's brief, written in code from the queue (how many need you, what's due, where to start), four figures to act on, and **Need you**, each claim with why it needs you and what the agent made of it; everything else folded below, in tabs with filters; red-team tests kept out; each claim due in ten business days | Done | #2, #117 |
| 12 | **Case brief**: the agent's verdict first (its conclusion, reason, checks passed and the one action this claim needs), then the evidence in tabs: story and items with every check, documents, the decision in full, signals, and what was asked; **Next** moves to the next claim that needs you | Done | #5, #117 |
| 13 | **Sign off**, **send back** or **override** with a reason code; over the approval limit waits for a senior handler (spec 27); **any handler decides a referral** within the approval limit | Done | #2, #117 |
| 14 | Ask the customer for documents, with the agent's next step drafted from the check that failed, and send an AI-drafted letter after editing it. The model writes only the paragraphs; code lays out the greeting and sign-off, so every letter has the same shape, and anything the handler should check shows above the letter, never in it | Done | #39, #117, Next |
| 15 | **Similar claims**: up to five decided claims of the same type nearest in amount | Done | #72 |
| 16 | **Retry**: carry on a claim the agent stopped working | Done | #57 |
| 17 | **Pause payouts**: a senior handler stops every payment from the header, saying why in a line; while paused, one quiet line under the header says who, when and why | Done | #8, #117 |
| 18 | **The agent switch**: off, every claim waits; a senior handler turns the agent on from the header, saying why in a line, and it works the waiting queue, a few at once, and each new claim as it comes in; off stops new work. The agent and payouts sit in one status group, green when on, red when off | Done | #70, #117 |
| 19 | **Settings** (senior handlers): payouts and the agent (approval limit, claims worked at once) and AI targets (accuracy, decided alone, improvement budget), each with one line of help and its range; every change recorded. **Reset the demo** by ticks: claims and decisions, evaluations, red-team results, agent off and payouts off, after a confirm | Done | #72, #117 |
| 19a | **A senior's Today**: payouts waiting for sign-off, **Wattle noticed** (findings counted in code from decisions and overrides: the check referrals most often fail, where handlers change the agent's decisions, how often they keep them) and a **spot check** of three claims the agent paid alone this week | Done | #117 |
| 20 | **Wattle AI Copilot**: answers as the handler who asked, acts only after a confirm card, and remembers preferences only (spec 22, 23, 27). Answers laid out like every Wattle's, with a card of what was checked or how the payout was worked out, from the claim's record; steps appear in turn | Done | #7, #113 |

## AI control plane (`console`)

In menu order: Overview, then the control plane's four jobs: Observe (Agents, Live, Trace), Evaluate (Scoreboard, Compare), Secure (Posture, Guardrails, Red team) and Govern (Cost, Versions, Audit log). The agent and payouts switches show in the header on every page, green when on and red when off; read-only here.

| # | Feature | Status | PR |
|---|---|---|---|
| 20a | **Overview** (home): *is the agent fit to run?* The verdict and next step, then widgets as Langfuse's home is built: claims worked, decided without a person, spend against the budget and guardrail hits, each with its trend; the agents map live beside what needs attention, the alerts and the releases; five release gates with likely ranges; the controls and how it's measured. Worked out in code; **How we measure** folded into one line, the controls left to the top bar | Done | #117, Next |
| 21 | **Scoreboard**: the version in use's exam as five square widgets (right decision, right amount, decided alone, reasons, cost), each with its likely range and target; the success criteria beside every version on one chart, accuracy by claim type, two runs compared; the five newest runs then five more a tap, a stalled run with **Stop**; **grow the exam** toward 100 claims from live claims a senior handler decided (signed off or overrode), each narrowing a score's likely range, never shown to the agent or the improver; below, one at a time as pill tabs: runs, by claim type, compare two runs, the exam's growth and running a practice test | Done | #9, #117, Next |
| 21a | **Compare models**: the same practice claims on up to three models and efforts (Haiku 5.5, Sonnet 5.5, Opus 5.5, Fable 5.2, low to max), on 1, 5 or 25 claims, each run up to three times. A fact card per model gives its price, speed and whether Australia offers it, and the cost shows before starting. Results: the cheapest that meets the targets in one line, worked out in code; right decisions against cost a claim on one chart; the judge's grade for each; a card per model with its range, each run and its cost, time and declines; the claims decided differently. **Propose** starts an improvement round with that model in the improver's place, so a person approves it and the exam decides; a compared model is never put in use by hand. **Head to head**: once the runs finish, the judge reads two models' explanations of each claim, blind and in both orders, and a grid shows how often each beat the other. **1 claim** beside 5 and 25 for a quick look | Done | Next |
| 22 | The judge grades each explanation against the handler's, 0 to 3 (spec 24) | Done | #70 |
| 23 | **Success criteria** worked out in code, the last 14 days live beside the exam | Done | #72 |
| 24 | **Live**: live results against targets, by version and claim type, a figure on under ten claims *too few to judge* rather than an alarm; disagreements as a review queue that feeds the evaluation set; **each agent day by day** (model calls, today against its usual day, an alert when unusual) and **live quality week by week** (decided, without a person, handler disagreed, cost a claim); below, one at a time as pill tabs: by version and claim type, disagreements, customer feedback, each agent day by day | Done | #72, #117, Next |
| 25 | **Versions**: what needs doing first, as four squares (the version in use, its exam, its red-team run, proposals waiting for you, amber when something's to do), then the release history as cards, each version named by what it changed (*#3 Cheaper model: Sonnet → Haiku*, worked out in code) with its exam, cost and red team; labelled In use, Being tested, Rolled back or Earlier, rejected ones folded away; a **shadow test** has another version decide copies of the 10 newest live claims (never paid) beside what was decided on each. The Improver agent proposes, an engineer approves, kept only if clearly better on the 25-claim exam; rollback with a reason. Each version opens a card | Done | #9, #117, Next |
| 26 | **Trace**: one claim's steps, model calls, security checks and cost in one timeline, opening on the fullest live claim, with the newest traces listed (calls, tokens, cost, model time); customers' names, card, phone and tax file numbers and email addresses are masked; every claim number elsewhere opens it; the steps scroll inside their card and a long reason folds to three lines | Done | #38, #117, Next |
| 27 | **Posture**: a plain verdict, four figures, defence in depth, the gaps to close, and each OWASP risk with its control and the attacks that test it, worked out in code; each agent's blast radius is on the agents map | Done | #99, #117 |
| 28 | **Guardrails**: *are the protections on, and do they work?* The answer in one line; each guardrail in the order a claim meets it, with where it sits, its mode, its hits on real claims, the red-team attacks it stopped and its false alarms (stopped, then approved by a handler); what fired, with what a person did next | Done | #99, #117 |
| 28a | **Agents**: a map of every agent and the code around it, how they connect and what each has done, Wattle's answers and the Copilot's turns and cost included; lines move while the agent works, the agent and payouts switches are gates on the claim's path, trust boundaries shown; **follow a claim** lights the parts it went through; each agent opens a card: model, tools, what it reads, the worst case if tricked and what stops it. It opens on the fullest recent claim and plays its path a stop a second, with its stops in a row (Replay, Clear); **Services** shows the same claim as the AWS services it used (or their local stand-ins); the trust boundaries carry the threat model's names (TB1a to TB6) | Done | #117, Next |
| 28b | **Audit log**: every switch, setting, override, reset, version and evaluation-set addition, who, when, why and what it was before, filtered, searched, 20 at a time, exported; **tamper-evident**: each entry sealed with a SHA-256 digest chained to the one before, checked on every read, an alert if a record changed after sealing; on AWS each seal is also copied to an S3 bucket with Object Lock (write-once); a changed seal names its records in words | Done | #117, Next |
| 28f | **Guardian**: code that watches each approval as it happens and holds one that doesn't add up (its own check failed, the claim was flagged, it pays more than was claimed, or the agent looped) for a senior handler, noting why on the trace; a row on Guardrails | Done | #117 |
| 28c | **Output guard**: card, phone and tax file numbers and email addresses are removed from what the agent writes (its reason, its requests to the customer) before anyone reads it, in code; the trace notes it and Guardrails counts it | Done | #117 |
| 28d | **Cost** (Govern, first): today against the daily budget, the month so far and where it's heading, cost per live claim and spend a day, as squares; where the spend goes (live claims, red team, exams, Wattle, Copilot), today by model, the dearest claims linked to their traces, over 7, 14 or 30 days. At the budget the agent switches itself off and the audit log says why; **spend a day** split by where it went, filling the rest of the page | Done | #117, Next |
| 28e | **Alerts**: a bell on every page with what needs an engineer now: a failing gate, the budget, a guardrail spike against its usual rate, the output guard, stalled runs; the count is the new ones, cleared on opening, and the list keeps each until it's fixed | Done | #117, Next |
| 29 | **Red team** (under Secure): fourteen attacks, each aimed at one layer and shown with it: seven hidden instructions for the instruction check, two of them disguised (base64, invisible Unicode); a quietly inflated claim for the agent; a 2,400 claim for the approval limit; another customer's claim for the api; two card numbers for the output guard. Listed with the risk each tests before the first run; after one, what stopped each | Done | #8, #117, Next |
| 30 | **Quality gate**: the `quality` workflow, by hand on `dev`, runs the evaluation set against the floors in `data/evals/gate.json` and the red team, and fails on any miss or any attack not held | Done | #114 |

Status: Planned, Next, Building, Done or Dropped (with the reason).
