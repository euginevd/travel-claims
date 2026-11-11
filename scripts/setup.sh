#!/usr/bin/env bash
# One-time setup: installs the GitHub CLI, gitleaks, Trivy, lefthook, uv and Terraform if missing, then the
# Git hooks and the Python environment, and reports what the machine has. Node (with npm) and Docker are
# reported but installed by hand: the web apps, the browser tests and the local stack need them.
# Usage: bash scripts/setup.sh           install what's missing, then report
#        bash scripts/setup.sh --check   report only, changing nothing; exits 1 if something is missing
set -uo pipefail

case "${1:-}" in
  "" | --check) ;;
  *) echo "Usage: bash scripts/setup.sh [--check]"; exit 1 ;;
esac

root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "Run this inside the repo, with git installed."; exit 1; }
cd "$root" || exit 1

# winget adds tools to the Windows user PATH, which an open shell doesn't see until it's reloaded.
reload_path() {
  command -v powershell.exe >/dev/null && command -v cygpath >/dev/null || return 0
  export PATH="$PATH:$(cygpath -p "$(powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','User')" | tr -d '\r')")"
}
reload_path

# Installs a tool with winget on Windows or Homebrew on macOS and Linux.
install() {
  local cmd=$1 winget_id=$2 brew_name=$3
  command -v "$cmd" >/dev/null && return 0
  if command -v winget >/dev/null; then
    winget install --id "$winget_id" --exact --accept-source-agreements --accept-package-agreements || return 1
    reload_path
  elif command -v brew >/dev/null; then
    brew install "$brew_name" || return 1
  else
    echo "Install $cmd by hand from its website, then run this again."
    return 1
  fi
  command -v "$cmd" >/dev/null || { echo "$cmd installed: open a new terminal, then run this again."; return 1; }
}

# A tool's installed version as major.minor.
installed() {
  { "$1" --version 2>/dev/null || "$1" version 2>/dev/null; } | grep -Eo '[0-9]+\.[0-9]+' | head -1
}

# The major.minor the pipeline pins for a tool, read from the workflows; nothing for a tool it doesn't pin.
pinned() {
  case "$1" in
    gitleaks) grep -ho 'gitleaks/gitleaks:v[0-9]*\.[0-9]*' .github/workflows/security.yml ;;
    trivy) grep -ho 'aquasec/trivy:[0-9]*\.[0-9]*' .github/workflows/security.yml ;;
    uv) grep -ho 'astral-sh/uv:[0-9]*\.[0-9]*' .github/workflows/apps.yml ;;
    terraform) grep -ho 'TF_VERSION: [0-9]*\.[0-9]*' .github/workflows/aws.yml ;;
  esac 2>/dev/null | head -1 | grep -o '[0-9]*\.[0-9]*$'
}

# One line per thing the workflow needs. A version that differs from the pipeline's is a note, not a failure.
report() {
  local missing=0 tool have want need
  line() { printf '  %-10s %s\n' "$1" "$2"; }
  # The oldest Terraform the units accept, from their versions.tf.
  need=$(grep -ho '>= [0-9]*\.[0-9]*' infra/aws/*/versions.tf 2>/dev/null | head -1 | cut -c4-)
  for tool in git gh gitleaks trivy lefthook uv terraform node npm docker; do
    if ! command -v "$tool" >/dev/null; then
      case "$tool" in
        node | npm) line "$tool" "MISSING: install Node 24 or later by hand" ;;
        docker) line "$tool" "MISSING: install Docker Desktop by hand" ;;
        *) line "$tool" "MISSING" ;;
      esac
      missing=$((missing + 1))
      continue
    fi
    have=$(installed "$tool")
    want=$(pinned "$tool")
    if [ -z "$have" ]; then
      line "$tool" "MISSING: found, but it doesn't run"
      missing=$((missing + 1))
    elif [ "$tool" = terraform ] && [ -n "$need" ] && [ "$(printf '%s\n' "$need" "$have" | sort -V | head -1)" != "$need" ]; then
      line "$tool" "MISSING: $have found, the units need $need or later; upgrade it with winget or brew"
      missing=$((missing + 1))
    elif [ -n "$want" ] && [ "$have" != "$want" ]; then
      line "$tool" "$have, the pipeline uses $want: install $want with winget or brew"
    else
      line "$tool" "$have"
    fi
  done
  if command -v gh >/dev/null; then
    if gh auth status --hostname github.com >/dev/null 2>&1; then
      line "gh sign-in" "ok"
    else
      line "gh sign-in" "MISSING: not confirmed; run gh auth login, or check the network"
      missing=$((missing + 1))
    fi
  fi
  if grep -qs lefthook "$(git rev-parse --git-path hooks/pre-push)"; then
    line "push hook" "ok"
  else
    line "push hook" "MISSING: pushes from this clone aren't scanned"
    missing=$((missing + 1))
  fi
  if [ -f pyproject.toml ] && [ ! -d .venv ]; then
    line "python env" "MISSING"
    missing=$((missing + 1))
  fi
  return "$missing"
}

if [ "${1:-}" = --check ]; then
  echo "This machine:"
  report && { echo "Ready."; exit 0; }
  echo "Not ready: see MISSING above; bash scripts/setup.sh installs the tools (not Node or Docker), the hook and the Python environment."
  exit 1
fi

install gh GitHub.cli gh || exit 1
install gitleaks Gitleaks.Gitleaks gitleaks || exit 1
install trivy AquaSecurity.Trivy trivy || exit 1
install lefthook evilmartians.lefthook lefthook || exit 1
install uv astral-sh.uv uv || exit 1
install terraform Hashicorp.Terraform hashicorp/tap/terraform || exit 1
lefthook install || exit 1
[ -f pyproject.toml ] && { uv sync || exit 1; }

echo "This machine:"
report || { echo "Not ready: see MISSING above."; exit 1; }
echo "Done: the tools, the Git hooks and the Python environment are ready."
echo "Check the scan: bash .lefthook/pre-push-scan.sh"
