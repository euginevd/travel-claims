#!/usr/bin/env bash
# Adds a ruleset to the repo's default branch: changes only through a squash-merged PR,
# no force pushes, no deletion. Safe to run again: it skips if the ruleset exists.
# Required status checks are added per project once its CI exists, in GitHub → Settings → Rules.
# Rulesets on private repos need GitHub Pro, Team or Enterprise; public repos work on any plan.
# Usage: bash scripts/protect-main.sh
set -uo pipefail

repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner) || exit 1

if gh api "repos/$repo/rulesets" --jq '.[].name' 2>/dev/null | grep -qx main; then
  echo "Ruleset 'main' already exists on $repo."
  exit 0
fi

gh api "repos/$repo/rulesets" -X POST --input - >/dev/null <<'JSON' || { echo "Could not add the ruleset: a private repo needs a paid GitHub plan."; exit 1; }
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
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

echo "Ruleset 'main' added to $repo."
