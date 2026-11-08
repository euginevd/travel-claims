#!/usr/bin/env bash
# Scans a folder: gitleaks for secrets, Trivy for packages, IaC and secrets; exits 1 to block the push.
# SCAN_SEVERITY sets Trivy's blocking levels (default HIGH,CRITICAL). Usage: scan.sh <folder> <label>
set -uo pipefail

[ $# -eq 2 ] || { echo "Usage: scan.sh <folder> <label>"; exit 1; }
dir=$1
label=$2

for tool in gitleaks trivy; do
  command -v "$tool" >/dev/null || { echo "$label: $tool not found, run bash scripts/setup.sh"; exit 1; }
done

failed=()

gitleaks dir "$dir" --no-banner --redact --exit-code 1 </dev/null || failed+=(gitleaks)

trivy fs "$dir" --quiet --scanners vuln,misconfig,secret \
  --severity "${SCAN_SEVERITY:-HIGH,CRITICAL}" --ignore-unfixed --exit-code 1 </dev/null || failed+=(trivy)

if [ ${#failed[@]} -gt 0 ]; then
  echo "$label: blocked by ${failed[*]}. Fix the findings above."
  exit 1
fi
echo "$label: passed"
