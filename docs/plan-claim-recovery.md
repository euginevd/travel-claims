# Plan: claim recovery and browser tests

Tier 1 only (Docker Compose). Closes status known gap 25 and starts the Playwright tests that gap 27 asks for. Every piece works the same way in tier 2, so the tests can later check tier 2 against tier 1.

## Why

1. A claim whose agent dies mid-work stays `in_progress` for ever: nothing notices, nothing carries it on, and a handler can't retry it (status 25). On AgentCore Runtime a session can end at any time, so tier 2 will hit this more often than a laptop does.
2. There are no browser tests, so nothing checks that the three apps still work end to end after a change, or that tier 2 behaves as tier 1 does (status 27).

## Design

### Heartbeats: noticing a stalled claim

3. A new `claims.heartbeat_at` column (migration `0011`), set by the `api` when it moves a claim to `in_progress` (`start_attempt`, a sent-back resume, a sign-off resume).
4. While the agent works a claim, a daemon thread beside it calls `POST /api/agent/claims/{id}/heartbeat` every 30 seconds with the claim's thread. The `api` updates `heartbeat_at` only when the claim is `in_progress` on that thread, so a late beat from an old attempt changes nothing. The beat stops when the work ends, however it ends.
5. A claim is **stalled** when it is `in_progress` and `heartbeat_at` is more than 2 minutes old (`STALLED_AFTER_SECONDS`, a setting). This is worked out when the claim is read; nothing writes it. A claim the runner failed on (its `error` step) stops beating too, so it also shows as stalled within 2 minutes.

### Carrying a claim on

6. A new agent route, `POST /carry-on {claim_id, thread_id}`, with the agent's key: it runs the existing `Runner.carry_on` on a thread of its own and answers 202 at once, or 409 when the claim is already being worked in this process (`Busy`). `carry_on` already picks the graph up from its last saved step, or starts afresh when nothing was saved, and does nothing for a claim already decided. The dispatcher's evaluation copies already use it.
7. The api's `AgentService` gains `carry_on`, through the same `_post`, so on AgentCore it goes through `/invocations` like `/work`.

### A handler retries a stalled claim

8. `POST /api/staff/claims/{id}/retry`, for a signed-in handler. It refuses with 409 unless the claim is stalled. It claims the retry by updating `heartbeat_at` only if it still holds the stale value it read (a compare-and-set), so two handlers pressing at once start one retry. It adds one to `recoveries` (new column), records a step ("Retried by Dana Whitfield"), commits, then asks the agent to carry on. If the agent can't be reached, it puts `heartbeat_at` back and answers 503, so the claim stays stalled and can be retried.
9. Dashboard: a **Stalled** chip on the queue and the claim page, stalled claims under **Needs me** after held payouts, and on a stalled claim a banner ("The agent stopped working on this claim 4 minutes ago") with **Retry** (R on the keyboard, like S, B and U). The claim page already polls while a claim is `in_progress`, so the steps show again once the agent carries on.

### Carrying stalled claims on automatically (tier 1)

10. When the agent's service starts, it asks the `api` for stalled claims (`GET /api/agent/stalled-claims`, with the agent's key) whose `recoveries` is under 2, and carries each on as in 8, through the same compare-and-set. So a crashed agent container that Docker restarts picks up its own work.
11. Compose gives the `agent` service `restart: unless-stopped`, so a crashed agent comes back.
12. The cap of 2 stops a claim that crashes the agent every time from crash-looping it: after two automatic tries it waits for a handler.
13. Tier 2 has no long-lived agent to start, so the automatic recovery there is *(planned)*: a scheduled sweep, such as EventBridge calling the same route. Until then the handler's **Retry** works in both tiers.

### Browser tests

14. Playwright in a new `e2e/` folder at the root, its own `package.json` (exact pins, `before=` date in `.npmrc`, as in the web apps), Chromium only. It runs against a running tier 1 stack: `npm test` in `e2e/` after `docker compose up`. Not in CI yet, which has no stack *(planned)*.
15. The tests sign in with each app's **Use test account** button. They make no model calls unless `E2E_LIVE=1`.
    - `portal.spec.ts`: Oliver Grant signs in, sees **My claims** with each trip's cover, opens a claim and sees its tracker.
    - `dashboard.spec.ts`: Dana Whitfield signs in, the queue opens on **Needs me**, she opens a claim and sees the case brief. A stalled claim shows its chip and banner, and **Retry** moves it back to working (with `E2E_LIVE=1`: the agent carries it on to a decision, about 3 cents of Claude).
    - `console.spec.ts`: Sam Carter signs in and sees the Scoreboard and the latest red-team report.
    - `recovery.spec.ts` (`E2E_LIVE=1` only): a handler works a claim, the test kills the agent's container mid-work, Docker restarts it, and the claim is carried on to a decision with no one pressing anything. About 3 cents.
16. A stalled claim is set up by the test itself, with a dev-only route in the `local` environment only, refused otherwise like the sign-in stand-in (threat model R5): `POST /api/dev/claims/{id}/stall` moves a waiting claim to `in_progress` with an old heartbeat. Its tests check that it's refused outside `local`.

## Security risks

17. **New R23, a retry starts the same claim twice** (Tampering, LLM06, ASI02), leading to two decisions or two payments. Controls: the compare-and-set in 8 and 10; `Busy` in the agent's process; and the existing ones, one decision per attempt and one payment per claim, enforced by the database (R2). Abuse-case tests: two retries at once, a retry on a claim that isn't stalled, a late heartbeat from an old thread.
18. **R4 extended:** the retry route needs a signed-in handler (a customer's or engineer's token fails, per decision 10). The heartbeat, stalled-claims and carry-on routes need the agent's key, are scoped to one claim and thread, and never stand in for a handler.
19. **R5 extended:** the stall route exists only when `ENVIRONMENT=local`, like the sign-in stand-in.
20. **R9:** retries cost model calls. Automatic recovery is capped at 2 a claim, and a handler's retry is one press per carry-on.

## Phases

### Phase 1: heartbeats and stalled claims (api, agent)

- [ ] Migration `0011`: `heartbeat_at` and `recoveries` on `claims`; set where a claim moves to `in_progress`
- [ ] `POST /api/agent/claims/{id}/heartbeat`, scoped to the claim and its thread
- [ ] The runner beats every 30 seconds while a claim works, and stops when the work ends
- [ ] `stalled` worked out on the claim and queue responses; web fixtures regenerated
- [ ] Tests: a beat moves the clock, a beat from an old thread doesn't, a claim goes stalled after 2 minutes, a failed claim goes stalled, the agent's key only

### Phase 2: retry and carry-on (api, agent)

- [ ] The agent's `POST /carry-on` over `Runner.carry_on`; `AgentService.carry_on` over HTTP and Runtime
- [ ] `POST /api/staff/claims/{id}/retry` with the compare-and-set, `recoveries`, a step and undo on 503
- [ ] Tests: retry on a stalled claim, 409 on one that isn't, two retries at once start one, 503 leaves it stalled, a customer's and an engineer's token refused

### Phase 3: automatic recovery (agent, compose)

- [ ] `GET /api/agent/stalled-claims` (recoveries under 2); the agent carries each on at start
- [ ] `restart: unless-stopped` on the `agent` service
- [ ] Tests: start-up carries on a stalled claim, skips one at the cap, and a decided claim isn't decided again

### Phase 4: dashboard

- [ ] Stalled chip, **Needs me** order, banner with **Retry** and R; claim page polls again after a retry
- [ ] Tests: chip, banner, retry refused shows the reason, keyboard R; WCAG 2.2 AA (jsx-a11y)

### Phase 5: Playwright

- [ ] `e2e/` package with pinned Playwright, `playwright.config.ts` pointing at 5173 to 5175, the dev-only stall route and its refusal tests
- [ ] The four specs in 15; `npm test` passes on a fresh `docker compose up`, and with `E2E_LIVE=1` too
- [ ] `status.md`: gap 25 closed, gap 27 narrowed, how to run the tests; `threat-model.md` R23; `README.md` one line on the tests

## PR groups

21. **One PR** for all five phases (the user's choice).

## Settled

22. **A second stack for the tests:** `docker compose -p undercover-recovery` with a ports override (`e2e/compose.ports.yml`, each port plus 100) and its own database volume, so it never touches another stack running on the laptop.
23. **Live tests stay opt-in** with `E2E_LIVE=1`, about 6 cents of Claude a run.
