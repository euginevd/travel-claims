<div align="center">

# Contributing

**Every change, by a person or a coding agent, goes through the same checks. The project's profile sets how much planning and approval it needs. This project is a `prototype` ([spec.md](docs/spec.md)).**

[Setup](#setup) · [Making a change](#making-a-change) · [Pull requests](#pull-requests)

</div>

## Setup

1. `bash scripts/setup.sh`, once per clone: installs the tools and the pre-push scan. `--check` reports what's missing.
2. Read [AGENTS.md](AGENTS.md) and [docs/code-standards.md](docs/code-standards.md). They're the rules for agents and people alike.

## Making a change

1. Start from the spec: a change it doesn't cover starts with an update to [docs/spec.md](docs/spec.md).
2. Plan before code, then build in phases with tests: [AGENTS.md](AGENTS.md), rules 14 to 16, with the gates for each profile in rule 12.
3. Never push to `main` or skip the pre-push scan.

## Pull requests

1. One PR per branch (rule 16), filled in from the template, including its **Security** line.
2. Every check passes and the security summary is clean; fix findings at their cause.
3. Update the branch if `main` has moved, then squash-merge: once approved in a `production` project, once checks pass in a `prototype`, where the agent merges without asking.

Security issues go through [SECURITY.md](SECURITY.md), never a public issue or PR.
