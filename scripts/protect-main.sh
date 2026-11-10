#!/usr/bin/env bash
# Hardens the repo: Actions settings, squash-only merges, GitHub's free security features, and a main ruleset.
# Safe to rerun: each run applies this file's settings again. The ruleset needs a public repo or a paid plan.
# Usage: bash scripts/protect-main.sh
set -uo pipefail

repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner) || exit 1
public=$(gh repo view --json visibility --jq '.visibility == "PUBLIC"')

# Runs one gh api call quietly; a failure shows its error and is counted.
failed=0
api() { gh api "$@" >/dev/null || failed=$((failed + 1)); }

# Squash merges only, and merged branches are deleted.
api -X PATCH "repos/$repo" -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false -F delete_branch_on_merge=true
# Workflow tokens are read-only unless a workflow asks for more, and can't approve PRs.
api -X PUT "repos/$repo/actions/permissions/workflow" -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false
# Only GitHub's actions and the two the deploy uses, each pinned to a full commit SHA.
api -X PUT "repos/$repo/actions/permissions" -F enabled=true -f allowed_actions=selected -F sha_pinning_required=true
api -X PUT "repos/$repo/actions/permissions/selected-actions" -F github_owned_allowed=true -F verified_allowed=false -f 'patterns_allowed[]=hashicorp/setup-terraform@*' -f 'patterns_allowed[]=aws-actions/configure-aws-credentials@*'
# Dependabot alerts and security-update PRs.
api -X PUT "repos/$repo/vulnerability-alerts"
api -X PUT "repos/$repo/automated-security-fixes"

if [ "$public" = true ]; then
  # Free on public repos: secret scanning with push protection, private reporting (SECURITY.md) and CodeQL.
  api -X PATCH "repos/$repo" --input - <<'JSON'
{"security_and_analysis": {"secret_scanning": {"status": "enabled"}, "secret_scanning_push_protection": {"status": "enabled"}}}
JSON
  api -X PUT "repos/$repo/private-vulnerability-reporting"
  # CodeQL runs from .github/workflows/codeql.yml; GitHub rejects its results while default setup is on.
  api -X PATCH "repos/$repo/code-scanning/default-setup" -f state=not-configured
  # Anyone can open a PR on a public repo: their workflow runs wait for your approval.
  api -X PUT "repos/$repo/actions/permissions/fork-pr-contributor-approval" -f approval_policy=all_external_contributors
  # No API for these, so the script can only remind you.
  echo "By hand, in Settings > Advanced Security: turn on everything except Agentic autofix, which uses AI credits."
fi

# Updates the ruleset in place when it exists, so a change here reaches repos made earlier.
id=$(gh api "repos/$repo/rulesets" --jq '.[] | select(.name == "main") | .id' 2>/dev/null)
if [ -n "$id" ]; then
  target=(-X PUT "repos/$repo/rulesets/$id")
else
  target=(-X POST "repos/$repo/rulesets")
fi

gh api "${target[@]}" --input - >/dev/null <<'JSON' || { echo "Could not set the ruleset; a private repo needs a paid GitHub plan."; failed=$((failed + 1)); }
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "python" }, { "context": "api-on-postgres" }, { "context": "portal" },
          { "context": "dashboard" }, { "context": "console" }, { "context": "secrets" }, { "context": "packages-and-iac" },
          { "context": "terraform" }, { "context": "code" }
        ]
      }
    },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["squash"]
      }
    }
  ]
}
JSON

if [ "$failed" -gt 0 ]; then
  echo "$failed settings failed on $repo; see the errors above."
  exit 1
fi
echo "Settings and ruleset 'main' applied to $repo."
