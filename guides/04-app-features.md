# App features

## 1. Overview

**UnderCover (travel-claims) is a pilot AI claims platform built with this template: four web apps on one laptop, each for a different person.**

| App | Who | Port | One line |
|-----|-----|:----:|----------|
| Demo home | Anyone seeing the project | 5172 | What it is, how it fits together, and links to the other three |
| Customer portal | Travellers | 5173 | Make a claim, send what's asked, get paid |
| Claims handler workspace | Claims handlers | 5174 | Work the queue and decide what the agent can't |
| AI assurance console | AI engineers and AI security engineers | 5175 | Quality and security for the claim agent |

Customers, handlers and the AI assurance console each have their own sign-in issuer and audience, so a token from one opens nothing in another. Locally, each sign-in page has a **Use test account** button.

## 2. Demo home (5172)

One page that explains the project, then sends you into the apps.

- **App cards:** a card for each app with what to try, its test account and a live dot showing whether it's running.
- **Live numbers:** claims in the system, the share decided by the agent alone, average model cost per claim, and red-team attacks held.
- **Try it in five minutes:** a guided script across the three apps, from a one-tap flight-delay claim to an evaluation run.
- **Architecture diagram:** select any part (portal, dashboard, console, api, agent, Copilot, context server, PostgreSQL, Claude) to see what it does, its tech and its trust boundary.
- **One claim's journey:** step through a claim moving across the parts, from the portal to payment.
- **Core concepts, security and stack:** short cards on human-in-the-loop limits, prompt-injection defence, evaluations, the kill switch, the secure pipeline and the tools used.

## 3. Customer portal (5173)

### My claims

- **Claims grouped** into In progress and Completed, each with a four-step tracker: Received, Assessing, Decision, Paid.
- **Flight-delay offers:** a flight on your trip that was late enough for your plan's cover, claimable in one tap with nothing to fill in.
- **"We need something from you"** on any claim waiting on you.
- **A claim you haven't sent:** finish it or discard it.
- **PayID:** add an email, mobile number or ABN so approved claims are paid straight to your bank.

### Make a claim

- **Three steps:** what happened (pick the trip and tap a tile), receipts (photos or PDFs), then check.
- **AI drafting assistant:** reads your words and receipts and drafts the claim for you to check; your words stay the record.
- **Helpers:** airport and city suggestions, a date picker limited to your trip.
- **Saved as you go:** leave and come back later (receipts aren't saved).

### A claim

- **What we need from you:** each document we've asked for, with its own upload button.
- **Where it stands:** the status in plain words, the decision's reason, and the amount paid and where it went.
- **Ask a person:** request a human review of a decision you disagree with.
- **Your claim:** what happened, the items and amounts, and your receipts, with more uploads while it waits.

### Updates

- **Every email and text** we've sent you about your claims, newest first, each linked to its claim.

## 4. Claims handler workspace (5174)

One workspace for claims handlers, who decide what the agent can't and check what it did. It shows why the agent decided, never what it cost: tokens and cost live in the AI assurance console.

### Queue

- **Counts at the top:** waiting, waiting for sign-off, decided, and paid so far.
- **Needs me first:** payouts waiting for sign-off, then referrals and customers' review requests.
- **Tabs and keyboard:** In progress, Waiting, Done and All; J and K to move, Enter to open.

### A claim

- **Case brief:** the agent's recommendation, a checklist of what it verified with sources, and the payout worked out line by line.
- **Screened claims:** when the hidden-instruction check stops a claim, it's flagged as screened, not decided by the agent.
- **Evidence:** the customer's story, items, receipts, documents and policy.
- **Ask the customer:** request a document; it appears on the customer's "what we need from you" list, they're emailed and texted, and you see when it's sent.
- **Decide:** approvals under $1,000 are paid automatically; you sign off anything larger, send it back to the agent with a note, or override with a reason code.
- **Agent activity:** every step the agent took in plain words; switch on the trace for each tool call and its sources.

### Across the workspace

- **Search (Ctrl+K):** jump to any claim or customer.
- **Ask Copilot:** a chat agent that answers questions and acts as you, with your own access and never more.
- **Payouts switch:** a senior handler can pause every payout at once. It stays with handlers, apart from the people who change the agent.

### Coming next

The handler to-do in [docs/status.md](../docs/status.md): three additions that show claims operations, AI and fraud expertise.

1. **Queue signals:** days open and a due date on each claim, sorted by urgency, and a "Documents in" chip when the customer has sent everything asked for.
2. **Risk panel:** receipts seen on other claims, repeat claims, the amount against typical, and the hidden-instruction check, as signals, never automatic declines.
3. **AI-drafted letters:** the agent drafts the customer's approval or decline explanation; the handler edits and sends it.

## 5. AI assurance console (5175)

Two sections for two roles: **Quality**, for the AI engineer who makes the agent decide well, and **Security**, for the AI security engineer who makes sure it can't be turned against the business. It sits apart from the handlers' workspace because these pages change how the agent behaves (OWASP admin-interface guidance, NIST 800-53 SC-2).

### Quality: Scoreboard

- **Start an evaluation:** the agent works copies of labelled claims, on the evaluation set or the held-out set; copies are never paid.
- **Runs:** accuracy, payout accuracy, straight-through rate and cost per claim for each run.
- **A run:** each claim beside the handler's decision, misses first, with the agent's reason; carry on a stopped run's unfinished claims.

### Quality: Claim trace

- **One claim's spend:** every model call with its tokens, cost and time, and every step the agent took.

### Quality: Improvement

- **Rounds:** the improver reads the misses and proposes a new configuration, shown as a diff with its reasons.
- **Approve or reject** with a reason; an approved version is kept only if it does better on the held-out set.
- **Versions:** every configuration with its model, effort, status and who proposed it.

### Security: Red team

- **Run the suite:** eight attack claims made as a test customer and worked by the agent.
- **Report:** each attack, its OWASP Top 10 for LLMs category, what the app did, and whether it held.

### Coming next

The AI assurance to-do in [docs/status.md](../docs/status.md): three additions that show security and AI engineering together.

1. **Threat coverage page (Security):** the OWASP Top 10 for LLM apps and for agentic applications (ASI01 to ASI10), mapped to MITRE ATLAS. Each row has UnderCover's control, the red-team attack that tests it, its last result, and when its guardrail last fired. Beside it, a small table of each agent's model, tools and MCP sources, and the payouts switch's status, read-only (it stays with senior handlers, apart from the people who change the agent).
2. **Red team as a gate (Quality and Security):** a new agent version from Improvement must pass the red team before it's kept, with the bypass rate tracked per version.
3. **Guardrail events:** hidden-instruction catches, refusals and duplicate-receipt hits, counted and shown as the "last fired" column on the threat coverage page.
