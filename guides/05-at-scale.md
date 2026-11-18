# 5. At scale: 250,000 claims a day

The prototype works about 25 claims a day. This guide works out what changes at 250,000 a day, ten thousand times more, and what the app would need. The figures are rough: each comes from what the prototype measures today.

## The numbers

| | Today | At 250,000 a day |
|---|---|---|
| Claims arriving | about one an hour | about 3 a second on average, 9 at peak |
| Claims in flight | 1 to 3 | about 175 on average, over 500 at peak (each takes a minute or so) |
| Model calls | about 300 a day | about 3 million a day, up to 100 a second |
| Claude's cost | under $1 a day | $5,000 to $10,000 a day (2 to 4 cents a claim) |
| Claims for a person | a few a day | about 80,000 a day, at 67% decided without a person |

## What it would need, most important first

1. **People are the bottleneck, not the agents.** 80,000 referrals a day means hundreds of handlers. Each point of the straight-through rate saves about 2,500 reviews a day. So the exam, Compare models and the improver matter more than raw speed, and so does what each referral asks of a handler (the case brief, the drafted request).
2. **A queue in place of the watcher.** Claims wait in a queue (SQS), and workers take them as capacity allows. When Bedrock's quotas fill, the queue holds claims back rather than failing them.
3. **Bedrock quotas, raised ahead of time.** Tokens and requests a minute for each model in Sydney. Australian data stays in Australia, so there's no overflow to other regions: the quota is the ceiling.
4. **One session per claim on AgentCore Runtime** (TODO 10), and claims picked up again after a restart, so a long day never loses work in flight.
5. **Cost controls for each agent.** Prompt caching for the instructions and the policy wording, which every claim reads; the judge grading a sample rather than every claim; a budget for each agent, with a circuit breaker that stops it, not the whole team.
6. **Limits and contention in the database.** Rate limits counted in the database (TODO 13), and care with rows every worker writes (the queue, the settings) on Aurora DSQL.
7. **Observability by sampling.** Every referral's trace kept in full, a sample of the rest, and the Overview's figures from aggregates rather than a count of every row.

## What stays the same

- **No model pays.** Payouts stay in code, checked against the approval limit, once a claim.
- **The guardian and the sign-off.** More claims means more held for a senior, so the sign-off queue needs its own staffing and alerts.
- **The red team and the exam,** run after every change, with the same gates.
