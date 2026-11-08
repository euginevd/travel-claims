# Secure agentic SDLC

## 1. Overview

**The secure agentic SDLC is the software development lifecycle with AI coding agents as developers and security built into every stage.**

- **People** own the what and the why: approving the spec, the plan, the merge and the deploy. You're accountable for what ships, so anything that should last goes in a doc, not chat, and the agent shows evidence before you approve.
- **Agents** own the how: they plan, write, test and review the code, inside written rules.
- **Controls** check every change before it ships: the pre-push scan, an independent review, the Terraform checks in CI and an approval gate.

The industry's emerging term is **agentic software development** (Forrester, Gartner), with no single standard yet; keeping "SDLC" in the name says existing security controls still apply. It draws on AWS's [AI-DLC](https://builder.aws.com/content/3KjWpM4sqd5f0zjUtE67OfUa7rk/ai-driven-development-life-cycle-ai-dlc-on-aws-a-new-approach-to-software-engineering), spec-driven development (GitHub Spec Kit), [AGENTS.md](https://agents.md), DevSecOps and the NIST Secure Software Development Framework (SSDF).

> **Note:** avoid the term ADLC. It's used both for this and for building AI agents as a product (the Agent Development Lifecycle).

## 2. Workflow: spec-driven development

The end-to-end flow, through the stages in section 3, for both a new project and each change after it: **a new project starts at step 1; every later change, such as a feature or a fix, starts at step 2.** You write the spec, the agent plans and builds from it, and every gate feeds findings back to the agent (↺) until the work is clean.

| # | Stage | Who | Step |
|:-:|-------|-----|------|
| 1 | Plan | Developer, agent | **Create the repo:** `gh repo create travel-claims --template euginevd/sdlc-template --private --clone` |
| 2 | Plan | Developer, agent | **Update the spec:** *"Update spec"*. ↺ Correct it until it says what you want |
| 3 | Plan | Agent | **Plan:** *"Plan <the work>"*. The agent writes the plan and threat model; no code |
| 4 | Plan | Developer | **Review the plan:** ↺ ask for changes to the plan and threat model, then approve |
| 5 | Code | Developer | **Implement:** *"Implement the plan"*. The agent works through the phases |
| 6 | Code | Agent | **Build each phase:** code, checks, subagent review, docs, then a local commit |
| 7 | Code | Agent | **Push:** the pre-push scan runs. ↺ The agent fixes findings, then opens a PR |
| 8 | Build and test | Pipeline, agent | **PR checks:** security scans and the Terraform plan. ↺ The agent fixes findings |
| 9 | Release | Developer, agent | **Merge:** you review and approve; the agent squash-merges and deletes the branch |
| 10 | Deploy | Developer, pipeline | **Apply:** you approve the Terraform plan; merges deploy `dev`, a manual run `prod` |
| 11 | Operate and monitor | Agent, developer | **Close the loop:** the agent updates status and decisions; findings feed step 2 |

## 3. The stages

The eight DevSecOps stages, the core security activities in each, and the open-source tools most teams reach for. Who does what is in the workflow (section 2).

| # | Stage | Core components | Open-source tools |
|:-:|-------|-----------------|-------------------|
| 1 | Plan | Data classification · threat modelling · security requirements and architecture | Mermaid (data flow diagram) · OWASP Threat Dragon · OWASP ASVS |
| 2 | Code | Secrets detection · static analysis (SAST, SCA, IaC) · repo hardening and code review | Gitleaks · Semgrep |
| 3 | Build | Image scanning and build gates · SBOM and signing · CI pipeline hardening | Trivy · Cosign |
| 4 | Test | DAST, API and pen testing · security regression tests · AI security testing | OWASP ZAP · promptfoo |
| 5 | Release | Artifact re-scan and promotion by digest · infrastructure plan review · release approval | Checkov · Trivy |
| 6 | Deploy | Admission control · GitOps deployment · secure workload configuration | Argo CD · Kyverno |
| 7 | Operate | Posture management · vulnerability management · AI posture management | Prowler · Trivy Operator |
| 8 | Monitor | Threat detection and logging · incident response · AI monitoring | Falco · Wazuh |

## 4. The template repo

A typical project made from [euginevd/sdlc-template](https://github.com/euginevd/sdlc-template), in order of importance. Items marked *(per plan)* or *(example)* appear as the project grows.

```
travel-claims/
├── AGENTS.md              01 the agent's rules, the same for every project; read first
├── README.md              02 front page: what it is and how to start
├── docs/                  03 what the agent builds from, in reading order:
│   ├── business-context.md   the business: industry, regulators, systems, people
│   ├── spec.md               the project, its stack, what we're building, what done means
│   ├── code-standards.md     how to write the code
│   ├── design-system.md      look and feel, from the design system
│   ├── status.md             what's built and what's next
│   ├── decisions.md          what's settled and why
│   ├── threat-model.md       data flow, top risks (STRIDE, OWASP)
│   ├── costs.md              what costs money, budget and alerts
│   └── plan-<name>.md        the plan being built (per plan; deleted when done)
├── apps/                  04 the product: one folder per app
│   ├── web/                  front end (example)
│   └── api/                  backend or agent (example)
├── aws/                   05 the infrastructure, as Terraform
│   ├── bootstrap/            CloudFormation, run once: OIDC, state bucket, CI roles
│   └── api/                  sample: Lambda behind an HTTP API, with logs
├── .github/workflows/     06 the pipeline, one workflow per job
│   ├── aws.yml               plan on the PR, apply after your approval
│   ├── ci.yml                each app's lint, types and tests (example)
│   └── security.yml          Gitleaks, Trivy and Checkov on every PR
├── lefthook.yml           07 runs the security scan on every push
├── .lefthook/             08 the pre-push hook script
├── scripts/               09 setup.sh installs the tools; scan.sh runs Gitleaks and Trivy;
│                             protect-main.sh adds the main ruleset
├── guides/                10 reference for people, numbered 01, 02, …
│   └── 01-agentic-sdlc.md    this guide: the lifecycle, workflow and template
└── SECURITY.md            11 how to report a vulnerability (GitHub's policy file)
```

## 5. The files

`AGENTS.md` and the files in `docs/`: what each holds, the key decision behind it, and how often it changes.

| File | What's in it | Changes |
|------|--------------|---------|
| `AGENTS.md` | Numbered rules for every coding agent: what to read, commands, workflow, boundaries, known mistakes. The same in every project | Rarely |
| `docs/business-context.md` | The business: who it is, regulators, data rules, risk appetite, systems, owners and tone. The same for every project for that business | Rarely |
| `docs/spec.md` | The project: name, problem, goal, users, AWS, stack, what done means, rules and what's out. The agent drafts it, you approve it | Often |
| `docs/code-standards.md` | Numbered coding rules the pipeline can't check: general, errors and logs, safe by design, tests, Terraform, languages, AI, docs | Rarely |
| `docs/status.md` | What's built, how to run it, known gaps, what's next | Always |
| `docs/decisions.md` | Key decisions with why and the alternative; superseded, never deleted | Sometimes |
| `docs/design-system.md` | The design system's tokens and rules an app uses, plus the project's UI choices. Optional | Rarely |
| `docs/threat-model.md` | Data flow, data classes, top risks mapped to STRIDE and OWASP, compliance. Optional | Sometimes |
| `docs/costs.md` | One row per resource that costs money, budget and alerts. Optional | Sometimes |

## 6. A sample plan

What the agent writes at step 3, here for a `travel-claims` change. It lives in `docs/plan-<name>.md` while it's built and is deleted when done.

```markdown
# Plan: receipt upload

Covers spec 9 and 17.

## Design

- `api`: `POST /claims/{id}/receipts` checks the claimant owns the claim and returns a presigned S3 upload URL: PDF, JPEG or PNG, up to 10 MB, valid for 5 minutes.
- Receipt bucket: private, KMS-encrypted, in `ap-southeast-2`, in a new Terraform unit `aws/receipts/`.
- `web`: an upload form on the claim page that sends the file straight to S3.

## Security risks

- A claimant uploads to someone else's claim: ownership check on every request (threat model R3); abuse-case test.
- Hidden text in a receipt: type and size checks; its text reaches the agent as data only (R1, spec 17).
- New flow across TB1: add it to the threat model's diagram.

## Phases

### 1. Bucket and upload URL
- [ ] Terraform passes fmt, validate and Checkov
- [ ] Only the claim's owner gets an upload URL; tests cover another claimant's request

### 2. Upload form
- [ ] A claimant uploads a receipt and sees it on the claim
- [ ] The form passes lint, typecheck and tests, and works by keyboard (WCAG 2.2 AA)

## PR groups

1. Phases 1–2 in one PR (about 300 lines).
```
