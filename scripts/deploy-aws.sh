#!/usr/bin/env bash
# Deploys the AWS build from nothing, one unit at a time in dependency order; a prototype's apply runs unattended.
# bash scripts/deploy-aws.sh apply|destroy [unit ...]   (needs gh, signed in; the bootstrap stack and repo variables set)
# With units named, runs only those, in the order given (such as: apply secrets functions agent).
set -euo pipefail

action=${1:-apply}
[ $# -gt 0 ] && shift
all=$([ $# -eq 0 ] && echo yes || echo no)
# Each unit's plan reads what the ones before it made; images go to ECR before the functions and agent.
order=(registry secrets database storage identity guardrail images functions agent web monitoring images)
# Destroy runs the other way, without the image builds.
[ "$action" = destroy ] && order=(monitoring web agent functions guardrail identity storage database secrets registry)
[ $# -gt 0 ] && order=("$@")

# Dispatches a workflow, waits for the run it started, and stops on a failure.
run() {
  local workflow=$1; shift
  local before
  before=$(gh run list --workflow "$workflow" --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId // 0')
  gh workflow run "$workflow" "$@"
  local id=$before
  while [ "$id" = "$before" ]; do
    sleep 5
    id=$(gh run list --workflow "$workflow" --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId // 0')
  done
  echo "Waiting for $workflow run $id (approve it in GitHub Actions if the apply environment has a reviewer)."
  gh run watch "$id" --exit-status >/dev/null
}

for unit in "${order[@]}"; do
  echo "== $unit"
  if [ "$unit" = images ]; then
    run images.yml -f deploy=false
  else
    run aws.yml -f target=dev -f unit="$unit" -f action="$action"
  fi
done
# A full teardown that finished switches deploys off, so the workflows skip AWS instead of failing.
if [ "$action" = destroy ] && [ "$all" = yes ]; then
  gh variable delete PROJECT_NAME
  echo "Deploys switched off (PROJECT_NAME removed)."
fi
echo "Done: $action"
