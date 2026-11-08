# Git hooks: pre-push scan

Every push is scanned by gitleaks and Trivy before it leaves your workstation. A finding stops the push, before it reaches GitHub, the pipeline or the cloud.

## What it achieves

- **Shift left:** secrets, vulnerable packages and IaC misconfigurations are caught before the push, not in the PR, the pipeline or production.
- **Secrets never leave your workstation.** A pushed secret must be rotated; a blocked push costs a local history fix.
- **Agent-safe.** Coding agents push the same way, so their work is checked too.

It's a first gate, not the control. Hooks can be skipped (`--no-verify`), so the pipeline stays the source of truth.

## Why pre-push, not pre-commit

Hooks that slow every commit get skipped, and agents commit often. Pre-push pays once per push and still stops anything leaving the workstation. Keep pre-commit for checks that take a second or two.

## How it works

| File | Does |
|------|------|
| `lefthook.yml` | Runs the `scan` job on `pre-push`, passing git's list of pushed refs |
| `.lefthook/pre-push-scan.sh` | Exports each pushed commit's files, plus the diffs of every commit not yet on the remote, and passes them to `scripts/scan.sh` |
| `scripts/scan.sh` | Runs `gitleaks dir` for secrets and `trivy fs` for vulnerabilities, IaC misconfigurations and secrets, lists the findings and blocks on any |
| `.gitattributes` | Keeps `*.sh` at LF so bash runs it on Windows |

- **Catches history too:** a secret committed and then removed before the push is still found in the diffs.
- **Blocks** on any gitleaks finding, on a Trivy finding at High or Critical, or when a tool is missing (fail closed).
- `SCAN_SEVERITY=MEDIUM,HIGH,CRITICAL` makes Trivy stricter for one push.

## Setup (once per clone)

1. Run `bash scripts/setup.sh`. It installs only what's missing (winget on Windows, Homebrew otherwise), so it's safe to run again: gitleaks, Trivy, lefthook, then `lefthook install`.
2. If `git config --global core.hooksPath` prints a path, lefthook won't install: remove it (`lefthook install --reset-hooks-path`) or point this clone at its own hooks (`git config core.hooksPath .git/hooks`).
3. Check: `lefthook run pre-push` scans `HEAD` and ends with `Pre-push scan: passed`.

## Day to day

- Blocked: read the findings above the summary. Fix, then rewrite the unpushed commits so the finding is gone from history too (`git commit --amend`, or `git reset --soft origin/<branch>` and commit again). Push again.
- A blocked secret never left your workstation, but rotate it if it was real.
- A false positive: add a `gitleaks:allow` comment on the line, or a `.trivyignore` entry, with the reason. Never skip the hook to get past it.

## Why lefthook

| Option | Verdict |
|--------|---------|
| **lefthook** *(chosen)* | One Go binary, no runtime. Config in git, so everyone runs the same hooks. Parallel jobs, globs and `{staged_files}` built in. Easy for people and agents to read and extend |
| Plain git hooks | Works with nothing installed: commit `.githooks/pre-push` and run `git config core.hooksPath .githooks` once. You hand-write parallel runs, globs and staged-file handling |
| pre-commit / prek | Best for its library of shared hooks (`terraform_fmt`, `tflint`, `checkov`, `gitleaks`). pre-commit needs Python and is slower; prek is its fast Rust rewrite with the same config |
| Husky | Needs Node and `package.json`; only for JS repos |

## Other scanners

Same `lefthook.yml` shape: one job per tool, each exits non-zero on a finding.

| Scan | Used here | Alternatives |
|------|-----------|--------------|
| Secrets | `gitleaks dir` | `trufflehog git` |
| IaC | `trivy fs --scanners misconfig` | `checkov -d .` |
| Vulnerable dependencies | `trivy fs --scanners vuln` | `osv-scanner -r .` |
| SAST | *(planned)* | `semgrep scan --config auto --error` |
| Container images | *(planned)* | `trivy image` |
| Licensed platforms | | Wiz (`wizcli scan dir`), Snyk (`snyk test`, `snyk iac test`) |

Pin tool versions in CI; scanners are supply-chain targets too.

## Known limits

- Secrets reach your local history before the push is blocked; clean it as in Day to day.
- Trivy's vulnerability scan needs a lock file (`uv.lock`, `package-lock.json`) to see dependencies.
