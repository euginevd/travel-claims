#!/usr/bin/env bash
# The last teardown step: deletes the bootstrap stack (GitHub sign-in, state bucket, roles, the CLI user and its key,
# the boundary) and the template the console uploaded, then checks nothing named the project is left. Paste it into
# AWS CloudShell in Sydney only once teardown-aws.sh prints "Clean but the bootstrap" and the agent has confirmed it,
# as it ends the agent's read-only access. Free; prints "Clean" when nothing is left.
{
  R=ap-southeast-2; P=travel-claims
  A=$(aws sts get-caller-identity --query Account --output text)

  # Empties a bucket, every version and delete marker, a thousand at a time; versioned buckets can't be deleted otherwise.
  empty() {
    local kind
    for kind in Versions DeleteMarkers; do
      while aws s3api list-object-versions --bucket "$1" --max-items 1000 \
        --query "{Objects: ${kind}[].{Key: Key, VersionId: VersionId}, Quiet: \`true\`}" --output json > /tmp/del.json 2>/dev/null \
        && grep -q '"Key"' /tmp/del.json; do
        aws s3api delete-objects --bucket "$1" --delete file:///tmp/del.json >/dev/null
      done
    done
  }

  # No "!" in this script: a paste into CloudShell reads it as history and drops the line.
  # Another repo's roles trusting GitHub would lose sign-in with the shared OIDC provider, so stop if there are any.
  others=$(aws iam list-roles --query "Roles[?contains(to_string(AssumeRolePolicyDocument), 'token.actions.githubusercontent.com') && starts_with(RoleName, '$P') == \`false\`].RoleName" --output text)
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

  # The console's cf-templates-* buckets: only the uploaded bootstrap template, and the bucket only if that leaves it empty,
  # so other projects' templates stay.
  for b in $(aws s3api list-buckets --query "Buckets[?starts_with(Name,'cf-templates-')].Name" --output text); do
    for k in $(aws s3api list-objects-v2 --bucket "$b" --query "Contents[?ends_with(Key,'bootstrap.yaml')].Key" --output text); do
      [ "$k" != None ] && aws s3api delete-object --bucket "$b" --key "$k" >/dev/null && echo "Deleted $b/$k"
    done
    [ "$(aws s3api list-objects-v2 --bucket "$b" --max-keys 1 --query 'KeyCount' --output text)" = 0 ] && aws s3api delete-bucket --bucket "$b" && echo "Deleted bucket $b"
  done

  # Anything the bootstrap leaves with the project's name.
  left=0
  check() { if [ -n "$2" ] && [ "$2" != None ]; then echo "LEFT  $1: $2"; left=1; fi; }
  check stacks "$(aws cloudformation list-stacks --region $R --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE DELETE_FAILED --query "StackSummaries[?contains(StackName,'$P')].StackName" --output text)"
  check buckets "$(aws s3api list-buckets --query "Buckets[?contains(Name,'$P') || starts_with(Name,'cf-templates-')].Name" --output text)"
  check roles "$(aws iam list-roles --query "Roles[?starts_with(RoleName,'$P')].RoleName" --output text)"
  check users "$(aws iam list-users --query "Users[?starts_with(UserName,'$P')].UserName" --output text)"
  check policies "$(aws iam list-policies --scope Local --query "Policies[?starts_with(PolicyName,'$P')].PolicyName" --output text)"
  [ "$left" = 0 ] && echo "Clean: nothing named $P is left in AWS"
}
