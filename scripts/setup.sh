#!/usr/bin/env bash
# One-time setup: installs gitleaks, Trivy, lefthook, uv and Terraform if missing, then the hooks. Usage: bash scripts/setup.sh
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 1

# winget adds tools to the Windows user PATH, which an open shell doesn't see until it's reloaded.
reload_path() {
  command -v powershell.exe >/dev/null || return 0
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

install gitleaks Gitleaks.Gitleaks gitleaks || exit 1
install trivy AquaSecurity.Trivy trivy || exit 1
install lefthook evilmartians.lefthook lefthook || exit 1
install uv astral-sh.uv uv || exit 1
install terraform Hashicorp.Terraform hashicorp/tap/terraform || exit 1
# Warns when the installed Terraform is older than the units need, as installs never upgrade.
want=$(grep -ho '>= [0-9]*\.[0-9]*' aws/*/versions.tf 2>/dev/null | head -1 | cut -c4-)
have=$(terraform version | head -1 | grep -o '[0-9]*\.[0-9]*' | head -1)
[ -n "$want" ] && [ "$(printf '%s\n' "$want" "$have" | sort -V | head -1)" != "$want" ] && echo "Terraform $have found, the units need $want: upgrade it with winget or brew."
lefthook install || exit 1
[ -f pyproject.toml ] && { uv sync || exit 1; }

echo "Done: the tools, the Git hooks and the Python environment are ready."
echo "Check: bash .lefthook/pre-push-scan.sh"
