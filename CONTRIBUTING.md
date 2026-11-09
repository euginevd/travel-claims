<div align="center">

# Contributing

**Every change, by a person or a coding agent, goes through the same plan, checks and review.**

[Setup](#️-setup) · [Making a change](#-making-a-change) · [Pull requests](#-pull-requests)

</div>

## 🛠️ Setup

1. `bash scripts/setup.sh`, once: installs the tools and the pre-push scan.
2. Read [AGENTS.md](AGENTS.md) and [docs/code-standards.md](docs/code-standards.md). They're the rules for agents and people alike.

## 🔁 Making a change

1. Start from the spec: a change it doesn't cover starts with an update to [docs/spec.md](docs/spec.md).
2. Plan before code, then build in phases with tests.
3. Never push to `main` or skip the pre-push scan.

## 🔀 Pull requests

1. One PR per plan, filled in from the template, including its **Security** line.
2. Every check passes and the security summary is clean; fix findings at their cause.
3. Update the branch if `main` has moved, then squash-merge.

Security issues go through [SECURITY.md](SECURITY.md), never a public issue or PR.
