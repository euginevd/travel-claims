#!/usr/bin/env bash
# Pre-flight checks for tier 2, by area: the account, Bedrock's models and the bootstrap's IAM policies; add new areas below.
# Paste it into AWS CloudShell in Sydney, or run it with the AWS CLI signed in. Costs under $0.001 in all.
{
  R=ap-southeast-2; P=travel-claims
  out=$(mktemp)

  echo "== Account"
  # The plan: PAID is needed for Claude (a Marketplace model) and CloudFront's Free plan (free).
  echo "Plan: $(aws freetier get-account-plan-state --query '[accountPlanType,accountPlanStatus]' --output text 2>/dev/null || echo 'unknown (check the Billing console)')"

  echo "== Bedrock"
  # Titan Text Embeddings V2, always needed by the policy wording's knowledge base (≈ $0.000001).
  if aws bedrock-runtime invoke-model --region "$R" --model-id amazon.titan-embed-text-v2:0 \
    --body '{"inputText":"hello"}' --cli-binary-format raw-in-base64-out "$out" >/dev/null 2>"$out.err"; then
    echo "OK    Titan Text Embeddings V2"
  else
    echo "NO    Titan Text Embeddings V2: $(head -c 200 "$out.err")"
  fi
  # Australia's Claude inference profiles, which the units use with MODEL_PROVIDER=bedrock (free).
  profiles=$(aws bedrock list-inference-profiles --region "$R" \
    --query "inferenceProfileSummaries[?starts_with(inferenceProfileId,'au.anthropic.claude')].inferenceProfileId" --output text)
  echo "Profiles: ${profiles:-none}"
  # One short reply from Haiku 5.5 and Sonnet 5.5, needed only with MODEL_PROVIDER=bedrock (≈ $0.0001 each).
  for model in claude-haiku-5-5 claude-sonnet-5-5; do
    id=$(printf '%s\n' $profiles | grep -m1 "$model")
    if [ -z "$id" ]; then
      echo "NO    $model: no Australian inference profile here"
      continue
    fi
    if reply=$(aws bedrock-runtime converse --region "$R" --model-id "$id" --inference-config maxTokens=5 \
      --messages '[{"role":"user","content":[{"text":"Say OK"}]}]' \
      --query 'output.message.content[0].text' --output text 2>"$out.err"); then
      echo "OK    $model ($id): $reply"
    else
      echo "NO    $model ($id): $(head -c 200 "$out.err")"
    fi
  done
  # A NO with AccessDenied: Bedrock console > Model catalog > the model > request access (Anthropic asks a short form).

  echo "== Bootstrap policies"
  # Each policy the stack made, through IAM Access Analyzer, which flags unknown actions and mistakes (free).
  if ! aws cloudformation describe-stacks --region "$R" --stack-name "$P-bootstrap" >/dev/null 2>&1; then
    echo "SKIP  the $P-bootstrap stack isn't deployed yet (runbook step 3)"
  else
    validate() {
      local found
      found=$(aws accessanalyzer validate-policy --region "$R" --policy-type IDENTITY_POLICY --policy-document "file://$out" \
        --query "findings[?findingType!='SUGGESTION'].[findingType,issueCode,findingDetails]" --output text)
      if [ -z "$found" ]; then echo "OK    $1"; else echo "CHECK $1:"; echo "$found" | sed 's/^/        /'; fi
    }
    A=$(aws sts get-caller-identity --query Account --output text)
    for name in boundary github-deploy-compute github-deploy-data github-deploy-ops github-deploy-ai; do
      arn=arn:aws:iam::$A:policy/$P-$name
      version=$(aws iam get-policy --policy-arn "$arn" --query Policy.DefaultVersionId --output text)
      aws iam get-policy-version --policy-arn "$arn" --version-id "$version" --query PolicyVersion.Document --output json > "$out"
      validate "$P-$name"
    done
    for pair in github-deploy:terraform-state github-deploy:project-iam github-plan:terraform-plan; do
      aws iam get-role-policy --role-name "$P-${pair%%:*}" --policy-name "${pair#*:}" --query PolicyDocument --output json > "$out"
      validate "$P-${pair%%:*} (${pair#*:})"
    done
    # SECURITY_WARNING on the wide statements is expected while building (decision 32); ERROR or an unknown action is not.
  fi

  rm -f "$out" "$out.err"
}
