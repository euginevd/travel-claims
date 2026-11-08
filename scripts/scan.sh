#!/usr/bin/env bash
# Security scan of a folder: gitleaks for secrets, Trivy for vulnerable packages, IaC
# misconfigurations and secrets. Lists the findings, then exits 0 to allow or 1 to block.
# Run by the pre-push hook (.lefthook/pre-push-scan.sh); kept separate so any folder can be scanned.
# SCAN_SEVERITY sets Trivy's blocking severities (default HIGH,CRITICAL).
# Usage: scan.sh <folder> <label>
set -uo pipefail

[ $# -eq 2 ] || { echo "Usage: scan.sh <folder> <label>"; exit 1; }
dir=$1
label=$2

for tool in gitleaks trivy; do
  command -v "$tool" >/dev/null || { echo "$label: $tool not found, see guides/02-git-hooks.md"; exit 1; }
done

failed=()

gitleaks dir "$dir" --no-banner --redact --exit-code 1 </dev/null || failed+=(gitleaks)

trivy fs "$dir" --quiet --scanners vuln,misconfig,secret \
  --severity "${SCAN_SEVERITY:-HIGH,CRITICAL}" --exit-code 1 </dev/null || failed+=(trivy)

if [ ${#failed[@]} -gt 0 ]; then
  echo "$label: blocked by ${failed[*]}. Fix the findings above."
  exit 1
fi
echo "$label: passed"
