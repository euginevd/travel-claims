# Business context

1. Business: UnderCover Travel Insurance (fictional), an Australian travel insurer, from Ed Donner's AI FDE course. Everything in its data is invented.
2. Plans: Economy, Premium and First. A small claims team works the queue by hand.
3. Regulators and laws: APRA (CPS 234 information security, CPS 230 operational risk), ASIC, the Privacy Act (including the automated decision-making rules from 10 December 2026) and the Notifiable Data Breaches scheme.
4. Data: customer data stays in Australia.
5. Risk appetite: low for customer data and payments. Changes ship to `dev` first, and to `prod` after sign-off.
6. Systems: the policy and claims records are the system of record; payments are simulated; handlers sign in with Amazon Cognito (a local stand-in in stage 1).
7. People: the head of claims operations owns the claims rules and the approval limit; data governance owns the context layer; the security team approves new data flows.
8. Tone: plain, friendly English; no insurance jargon.
