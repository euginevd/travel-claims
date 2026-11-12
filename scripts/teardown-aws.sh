#!/usr/bin/env bash
# Tears down what scripts/deploy-aws.sh destroy leaves (the bootstrap stack, leftover and cf-templates-* buckets), then lists anything left.
# Paste it into AWS CloudShell in Sydney, after `bash scripts/deploy-aws.sh destroy`. Free; prints "Clean" when nothing is left.
{
  R=ap-southeast-2; P=travel-claims; P_=travel_claims
  A=$(aws sts get-caller-identity --query Account --output text)

  # Empties a bucket, every version and delete marker, a thousand at a time; versioned buckets can't be deleted otherwise.
  empty() {
    local kind
    for kind in Versions DeleteMarkers; do
      while aws s3api list-object-versions --bucket "$1" --max-items 1000 \
        --query "{Objects: $kind[].{Key: Key, VersionId: VersionId}, Quiet: \`true\`}" --output json > /tmp/del.json 2>/dev/null \
        && grep -q '"Key"' /tmp/del.json; do
        aws s3api delete-objects --bucket "$1" --delete file:///tmp/del.json >/dev/null
      done
    done
  }

  # Another repo's roles trusting GitHub would lose sign-in with the shared OIDC provider, so stop if there are any.
  others=$(aws iam list-roles --query "Roles[?contains(to_string(AssumeRolePolicyDocument), 'token.actions.githubusercontent.com') && !starts_with(RoleName, '$P')].RoleName" --output text)
  if [ -n "$others" ]; then
    echo "STOP  other roles trust GitHub ($others): redeploy the bootstrap with CreateOidcProvider=false before deleting it."
  else
    # Empty the versioned state bucket, which CloudFormation can't delete with files in it.
    empty "$P-tfstate-$A"
    # The CLI user's access keys are made in the console, so the stack can't delete the user until they're gone.
    for k in $(aws iam list-access-keys --user-name $P-cli --query 'AccessKeyMetadata[].AccessKeyId' --output text 2>/dev/null); do
      aws iam delete-access-key --user-name $P-cli --access-key-id "$k" && echo "Deleted the CLI user's access key"
    done
    # Delete the bootstrap: OIDC provider, state bucket, roles, the CLI user and boundary.
    aws cloudformation delete-stack --region $R --stack-name $P-bootstrap
    aws cloudformation wait stack-delete-complete --region $R --stack-name $P-bootstrap && echo "Deleted the bootstrap stack"
  fi

  # Leftover project buckets. The model logs' bucket denies deletes to all but the deploy role, so its
  # policy goes first (an account admin may remove a bucket policy).
  for b in $(aws s3api list-buckets --query "Buckets[?contains(Name,'$P')].Name" --output text); do
    aws s3api delete-bucket-policy --bucket "$b" 2>/dev/null
    empty "$b"
    aws s3api delete-bucket --bucket "$b" && echo "Deleted bucket $b"
  done
  # The console's cf-templates-* buckets: only the uploaded bootstrap template, and the bucket only if that leaves it empty,
  # so other projects' templates stay.
  for b in $(aws s3api list-buckets --query "Buckets[?starts_with(Name,'cf-templates-')].Name" --output text); do
    for k in $(aws s3api list-objects-v2 --bucket "$b" --query "Contents[?ends_with(Key,'bootstrap.yaml')].Key" --output text); do
      [ "$k" != None ] && aws s3api delete-object --bucket "$b" --key "$k" >/dev/null && echo "Deleted $b/$k"
    done
    [ "$(aws s3api list-objects-v2 --bucket "$b" --max-keys 1 --query 'KeyCount' --output text)" = 0 ] && aws s3api delete-bucket --bucket "$b" && echo "Deleted bucket $b"
  done

  # AgentCore's own log groups, which no unit owns (a few cents a month if left).
  for g in $(aws logs describe-log-groups --region $R --log-group-name-prefix /aws/bedrock-agentcore/ --query 'logGroups[].logGroupName' --output text | tr '\t' '\n' | grep -i travel); do
    aws logs delete-log-group --region $R --log-group-name "$g"
  done

  # Anything left with the project's name, by service; CloudFront takes up to 15 minutes, so paste again if it's listed.
  left=0
  check() { if [ -n "$2" ] && [ "$2" != None ]; then echo "LEFT  $1: $2"; left=1; fi; }
  check stacks "$(aws cloudformation list-stacks --region $R --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE DELETE_FAILED --query "StackSummaries[?contains(StackName,'$P')].StackName" --output text)"
  check buckets "$(aws s3api list-buckets --query "Buckets[?contains(Name,'$P') || starts_with(Name,'cf-templates-')].Name" --output text)"
  check vector-buckets "$(aws s3vectors list-vector-buckets --region $R --query "vectorBuckets[?contains(vectorBucketName,'$P')].vectorBucketName" --output text)"
  check functions "$(aws lambda list-functions --region $R --query "Functions[?contains(FunctionName,'$P')].FunctionName" --output text)"
  check ecr "$(aws ecr describe-repositories --region $R --query "repositories[?contains(repositoryName,'$P')].repositoryName" --output text)"
  check parameters "$(aws ssm describe-parameters --region $R --query "Parameters[?contains(Name,'$P')].Name" --output text)"
  check dsql "$(aws dsql list-clusters --region $R --query "clusters[].identifier" --output text)"
  check dynamodb "$(aws dynamodb list-tables --region $R --query "TableNames[?contains(@,'$P')]" --output text)"
  check waf "$(aws wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1 --query "WebACLs[?contains(Name,'$P')].Name" --output text)"
  check cloudfront "$(aws cloudfront list-distributions --query "DistributionList.Items[?contains(Comment,'$P')].[Id,Status]" --output text)"
  check cognito "$(aws cognito-idp list-user-pools --region $R --max-results 60 --query "UserPools[?contains(Name,'$P')].Name" --output text)"
  check runtimes "$(aws bedrock-agentcore-control list-agent-runtimes --region $R --query "agentRuntimes[?contains(agentRuntimeName,'$P_')].agentRuntimeName" --output text)"
  check gateways "$(aws bedrock-agentcore-control list-gateways --region $R --query "items[?contains(name,'$P')].name" --output text)"
  check memories "$(aws bedrock-agentcore-control list-memories --region $R --query "memories[?contains(id,'$P_')].id" --output text)"
  check knowledge-bases "$(aws bedrock-agent list-knowledge-bases --region $R --query "knowledgeBaseSummaries[?contains(name,'$P')].name" --output text)"
  check guardrails "$(aws bedrock list-guardrails --region $R --query "guardrails[?contains(name,'$P')].name" --output text)"
  check topics "$(aws sns list-topics --region $R --query "Topics[?contains(TopicArn,'$P')].TopicArn" --output text)"
  check alarms "$(aws cloudwatch describe-alarms --region $R --alarm-name-prefix $P --query "MetricAlarms[].AlarmName" --output text)"
  check budgets "$(aws budgets describe-budgets --account-id "$A" --query "Budgets[?contains(BudgetName,'$P')].BudgetName" --output text 2>/dev/null)"
  check analyzers "$(aws accessanalyzer list-analyzers --region $R --query "analyzers[?contains(name,'$P')].name" --output text)"
  check roles "$(aws iam list-roles --query "Roles[?starts_with(RoleName,'$P')].RoleName" --output text)"
  check policies "$(aws iam list-policies --scope Local --query "Policies[?starts_with(PolicyName,'$P')].PolicyName" --output text)"
  check log-groups "$(aws logs describe-log-groups --region $R --query "logGroups[?contains(logGroupName,'$P') || contains(logGroupName,'$P_')].logGroupName" --output text)"
  [ "$left" = 0 ] && echo "Clean: nothing named $P is left in AWS"
}
