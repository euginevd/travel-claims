Ordered by effort, smallest first. Each item ends with what it delivers before any code: a proposal, a plan, or a mockup.

## Small: a proposal, then about half a day

1. **Sign-in pages.** The three sign-in pages (portal, dashboard, control plane) haven't changed while the apps did. Audit the message and the animation on the left of each, then propose whether to change them. Build only once the proposal is agreed.

## Medium: a plan, then one to two days each

2. **Model playground** in the control plane. Run the same claims on different models and effort levels, and compare time, cost, pass or fail, and quality side by side. An engineer can then pick a model for each agent from the results. Check how others build playgrounds (Bedrock, LangSmith, Braintrust). Deliver a plan and a mockup.
3. **Red team, rethought.** First check whether a red-team run works at all; it seems not to. Then reconsider the name and the scope:
   - is "red team" the right word, or is something more common (AI security testing, adversarial testing) clearer and wider than prompt injection?
   - what do real tools test beyond prompt injection (Garak, PyRIT, Promptfoo)?
   - should it move from Evaluate to Secure?

   Deliver a proposal, checked online.
4. **The agents page, rethought** (`#/agents`).
   - Follow a claim: a rich claim chosen by default, its path shown as a slow animation, with a Clear button beside it.
   - The path drawn in AWS architecture style: customer, portal, Wattle, then every component it touches (Guardrails, AgentCore and the rest), based on what the claim actually used.
   - Check that the trust boundaries are right.
   - Each agent shown with its spec, lit green while it works.
   - Check online how others show this to an AI engineer.

   Deliver a plan and a mockup.

## Large: research and a plan first, several days each

5. **The Secure tab, rethought.** Map what we check against the OWASP Top 10 for LLM applications, the OWASP agentic AI threats, the newer AI threat-modelling frameworks (MAESTRO and others) and MCP security. Then plan how the tab covers them, checked against how others do it.
6. **Privacy and personal data.**
   - Who sees which data: what handlers may and may not see, and whether AI engineers may see claim data, and which kinds.
   - Masking, encryption, retention.
   - Which regulations apply: the Australian Privacy Act and its Privacy Principles, the notifiable data breach scheme, and APRA CPS 234 for insurers.
   - Breach notification.

   Deliver recommendations and a plan to build them in.
7. **Agents as the centrepiece of the control plane's Overview.**
   - Agents with personas.
   - Tool calls, and one agent calling another, shown as they happen.
   - A swarm: what changes at 250,000 claims a day instead of 25 (queueing, concurrency, cost, limits), and the features that scale needs.

   Deliver a plan.
8. **Walkthrough video, re-recorded.** It covers:
   - the landing page;
   - GitHub, quickly: repo structure, architecture diagram, threat model;
   - the customer portal, making a claim and its AI features;
   - the handlers' dashboard, working claims with the agents;
   - the control plane's AI and security features.

   It's edited: zooms, annotations, a voiceover. A sleek, minimal thumbnail keeps the landing page uncluttered before it plays. Deliver a plan first, then record. Do this last, once the screens above have settled.
