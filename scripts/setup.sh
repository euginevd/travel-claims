#!/usr/bin/env bash
# One-time developer setup: gitleaks, Trivy, lefthook and the Git hooks.
# Installs only what's missing, so it's safe to run again. Usage: bash scripts/setup.sh
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 1

# Installs a tool with winget on Windows or Homebrew on macOS and Linux.
install() {
  local cmd=$1 winget_id=$2 brew_name=$3
  command -v "$cmd" >/dev/null && return 0
  if command -v winget >/dev/null; then
    winget install --id "$winget_id" --exact --accept-source-agreements --accept-package-agreements || return 1
    export PATH="$LOCALAPPDATA/Microsoft/WinGet/Links:$PATH"
  elif command -v brew >/dev/null; then
    brew install "$brew_name" || return 1
  else
    echo "Install $cmd by hand (guides/02-git-hooks.md), then run this again."
    return 1
  fi
  command -v "$cmd" >/dev/null || { echo "$cmd installed: open a new terminal, then run this again."; return 1; }
}

install gitleaks Gitleaks.Gitleaks gitleaks || exit 1
install trivy AquaSecurity.Trivy trivy || exit 1
install lefthook evilmartians.lefthook lefthook || exit 1
lefthook install || exit 1

echo "Done: gitleaks, Trivy and the Git hooks installed."
echo "Check: lefthook run pre-push"
