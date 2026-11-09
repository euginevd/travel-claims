# App features

## 1. Overview

**UnderCover (travel-claims) is a pilot AI claims platform, built with the [sdlc-template](https://github.com/euginevd/sdlc-template) secure agentic SDLC: four web apps on one laptop, each for a different person.**

| App | Who | Port | Test account | One line |
|-----|-----|:----:|--------------|----------|
| Demo home | Anyone seeing the project | 5172 | None | What it is, how it fits together, and links to the other three |
| Customer portal | Travellers | 5173 | Oliver Grant | Make a claim, send what's asked, get paid |
| Claims handler workspace | Claims handlers | 5174 | Dana Whitfield, senior handler | Work the queue and decide what the agent can't |
| AI assurance console | AI engineers and AI security engineers | 5175 | Priya Raman, AI engineer | Quality and security for the claim agent |

What it demonstrates:

- **AI engineering:** Claude agents that decide claims, scored against handlers' decisions and improved only with a person's approval.
- **Security:** a sign-in issuer and audience for each app, so a token from one opens nothing in another; a hidden-instruction check before the agent reads anything, a red team, and limits enforced in code, not prompts.
- **Claims operations:** routine claims paid in minutes, and people for anything that needs judgement.

Locally, each sign-in page has a **Use test account** button. To run it, see the README's **Run it**.

## 2. Demo home (5172)

One page that explains the project, then sends you into the apps. Local only: no sign-in, no customer data, and never deployed.

### Get started

- **App cards:** a card for each app with what to try, its test account and a live dot showing whether it's running.
- **Live numbers:** claims in the system, the share decided by the agent alone, average model cost per claim, and red-team attacks held. Counts only, from a route that exists only on a laptop.
- **Try it in five minutes:** a guided script across the three apps, from a one-tap flight-delay claim to an evaluation run.

### How it works

- **Architecture diagram:** select any part (portal, dashboard, console, api, agent, Copilot, context server, PostgreSQL, Claude) to see what it does, its tech and its trust boundary.
- **One claim's journey:** step through a claim moving across the parts, from the portal to payment.
- **Core concepts, security and stack:** short cards on human-in-the-loop limits, prompt-injection defence, evaluations, the kill switch, the secure pipeline and the tools used.

## 3. Customer portal (5173)

One portal for travellers: claim in minutes and always know where it stands. AI does the paperwork and says when it helped; people decide anything uncertain.

### My claims

- **Claims grouped** into In progress and Completed, each with a four-step tracker: Received, Assessing, Decision, Paid.
- **Flight-delay offers:** a flight on your trip that was late enough for your plan's cover, claimable in one tap with nothing to fill in.
- **Waiting on you:** a flag on any claim where we've asked for something.
- **A claim you haven't sent:** finish it or discard it.
- **PayID:** add an email, mobile number or ABN so approved claims are paid straight to your bank.

### Make a claim

- **Three steps:** what happened (pick the trip and tap a tile), receipts (photos or PDFs), then check.
- **AI drafting assistant:** reads your words and receipts and drafts the claim for you to check. Your words stay the record, it never sends anything itself, and it's limited to 10 drafts an hour.
- **Helpers:** airport and city suggestions, a date picker limited to your trip.
- **Saved as you go:** leave and come back later (receipts aren't saved).
- **Receipts checked:** files are checked by their contents (JPEG, PNG or PDF), up to 5 MB each and 5 a claim.

### A claim

- **What we need from you:** each document we've asked for, with its own upload button.
- **Where it stands:** the status in plain words, the decision's reason, and the amount paid and where it went.
- **AI disclosure:** a decision says when it was made with help from the AI claims agent.
- **Referrals kept private:** a referred claim says a handler will look at it, never the internal reason, so screening and fraud checks stay hidden.
- **Ask a person:** request a human review of a decision you disagree with.
- **Your claim:** what happened, the items and amounts, and your receipts, with more uploads while it waits.

### Across the portal

- **Updates:** every email and text we've sent you about your claims, newest first, each linked to its claim.
- **Only your own claims:** every page shows only the signed-in customer's claims.

### Coming next

From the to-do in [docs/status.md](../docs/status.md):

1. **Policy at a glance:** a "what you're covered for" card for each trip, with its limits, excess and delay waiting time.
2. **Ask about my claim:** a chat on the claim page that answers from the claim and policy with the customer's own access, defended against prompt injection like the claim agent.

## 4. Claims handler workspace (5174)

One workspace for claims handlers, who decide what the agent can't and check what it did. It shows why the agent decided; what it cost is in the AI assurance console.

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

From the to-do in [docs/status.md](../docs/status.md):

1. **Queue signals:** days open and a due date on each claim, sorted by urgency, and a "Documents in" chip when the customer has sent everything asked for.
2. **Risk panel:** receipts seen on other claims, repeat claims and the amount against typical for the claim type, as signals, never automatic declines.
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

From the to-do in [docs/status.md](../docs/status.md):

1. **Threat coverage page (Security):** the OWASP Top 10 for LLM apps and for agentic applications (ASI01 to ASI10), mapped to MITRE ATLAS. Each row has UnderCover's control, the red-team attack that tests it, its last result, and when its guardrail last fired (hidden-instruction catches, refusals, duplicate receipts). Beside it, a small table of each agent's model, tools and MCP sources, and the payouts switch's status, read-only.
2. **Red team as a gate (Quality and Security):** a new agent version from Improvement must pass the red team before it's kept, with the bypass rate tracked per version.
