#!/usr/bin/env bash
# Copies the bootstrap stack's outputs and the Anthropic key into GitHub, and sets the repository's variables.
# bash scripts/use-anthropic.sh or scripts/use-bedrock.sh, which run this with the provider set.
# Values come from .env when set there, otherwise from CloudFormation or a gh prompt; none is ever printed.
# Needs: gh signed in, and the bootstrap's outputs in .env or the AWS CLI signed in. The bootstrap's names are fixed,
# so its outputs stay the same: role/travel-claims-github-plan, role/travel-claims-github-deploy and
# travel-claims-tfstate-<account>. Makes the aws-dev-plan and aws-dev-apply environments if they're missing (free).
set -euo pipefail

provider=${1:-anthropic}
case "$provider" in anthropic | bedrock) ;; *) echo "Usage: $0 [anthropic|bedrock]"; exit 1 ;; esac
root=$(git rev-parse --show-toplevel)
# Whether deploys were already on, so a change of provider redeploys the units that use it.
deployed=$(gh variable get PROJECT_NAME 2>/dev/null || true)

# The environments: plan with no rules; apply from main only, with no reviewer, as a prototype's dev (AGENTS.md 24).
gh api -X PUT "repos/{owner}/{repo}/environments/aws-dev-plan" --silent
printf '%s' '{"reviewers":[],"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'   | gh api -X PUT "repos/{owner}/{repo}/environments/aws-dev-apply" --input - --silent
gh api "repos/{owner}/{repo}/environments/aws-dev-apply/deployment-branch-policies" --jq '.branch_policies[].name' | grep -qx main   || gh api -X POST "repos/{owner}/{repo}/environments/aws-dev-apply/deployment-branch-policies" -f name=main -f type=branch --silent
stack=travel-claims-bootstrap
region=ap-southeast-2

# A value from .env, read as data (never sourced), or empty.
from_env() {
  [ -f "$root/.env" ] || return 0
  sed -n "s/^$1=//p" "$root/.env" | tail -1 | tr -d '\r' | sed 's/^"\(.*\)"$/\1/'
}

# One of the bootstrap stack's outputs: .env's value under the GitHub name, else CloudFormation's.
output() {
  local value
  value=$(from_env "$1")
  [ -n "$value" ] && { printf '%s' "$value"; return; }
  aws cloudformation describe-stacks --region "$region" --stack-name "$stack" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text
}

bucket=$(output TF_STATE_BUCKET StateBucketName)
gh variable set TF_STATE_BUCKET --env aws-dev-plan --body "$bucket"
gh variable set TF_STATE_BUCKET --env aws-dev-apply --body "$bucket"
gh variable set AWS_PLAN_ROLE_ARN --env aws-dev-plan --body "$(output AWS_PLAN_ROLE_ARN PlanRoleArn)"
gh variable set AWS_DEPLOY_ROLE_ARN --env aws-dev-apply --body "$(output AWS_DEPLOY_ROLE_ARN DeployRoleArn)"
gh variable set MODEL_PROVIDER --body "$provider"

# Optional settings, only when .env has them.
for name in ALERT_EMAIL CLOUDFRONT_FREE_PLAN NETWORK_MODE EVALUATION_SAMPLING API_GATEWAY STAFF_SAML_METADATA_URL STAFF_SIGN_IN_URLS ENCRYPTION_KEYS DOMAIN_NAME MALWARE_SCANNING LOG_MASKING DATABASE_APP_ROLE; do
  value=$(from_env "$name")
  if [ -n "$value" ]; then printf '%s' "$value" | gh variable set "$name"; fi
done

# Piped to gh on stdin, so a key is never on a command line, in the history or on screen.
secret() {
  local value
  value=$(from_env "$1")
  if [ -n "$value" ]; then
    printf '%s' "$value" | gh secret set "$1" --env aws-dev-apply
  else
    echo "Paste $1:"
    gh secret set "$1" --env aws-dev-apply
  fi
}
if [ "$provider" = anthropic ]; then
  secret ANTHROPIC_API_KEY
  secret ANTHROPIC_WORKSPACE_ID
fi

# Last, as it switches deploys on.
gh variable set PROJECT_NAME --body travel-claims

# Already deployed: apply the units that hold or use the provider; otherwise step 5 deploys everything.
if [ -n "$deployed" ]; then
  echo "GitHub is set up for $provider. Applying secrets, functions and agent so the apps use it."
  bash "$root/scripts/deploy-aws.sh" apply secrets functions agent
else
  echo "GitHub is set up for $provider. Next: bash scripts/deploy-aws.sh apply"
fi
