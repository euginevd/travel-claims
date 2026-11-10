# Cleaning up AWS

Removes everything travel-claims puts in AWS, so nothing is charged, then proves it. The code, the GitHub repo and Supabase stay, so you can redeploy ([status.md](../docs/status.md) 48). Done once on 2026-11-10; about 20 minutes. Run the AWS commands in **AWS CloudShell** in Sydney (`ap-southeast-2`).

## 1. Destroy the Terraform units

From the repo, with `PROJECT_NAME` still set:

```bash
gh workflow run aws.yml -f target=dev -f unit=all -f action=destroy
```

Approve the run in GitHub Actions once its eight plans pass. Every `apply (<unit>)` job must end green; rerun a failed unit with `-f unit=<unit>`. In `dev` the buckets, ECR repositories and the app secret delete at once (`force_destroy`, `force_delete`, no recovery window).

## 2. Delete the two CloudFormation stacks

```bash
R=ap-southeast-2
aws cloudformation delete-stack --region $R --stack-name travel-claims-database-url
aws cloudformation wait stack-delete-complete --region $R --stack-name travel-claims-database-url && echo "database-url deleted"
```

Only the bootstrap stack's roles should trust GitHub; if this lists other roles, keep the OIDC provider (see the note below):

```bash
aws iam list-roles --query "Roles[?contains(to_string(AssumeRolePolicyDocument), 'token.actions.githubusercontent.com')].RoleName" --output text
```

Empty the versioned state bucket, then delete the bootstrap stack:

```bash
B=travel-claims-tfstate-$(aws sts get-caller-identity --query Account --output text)
for kind in Versions DeleteMarkers; do
  aws s3api list-object-versions --bucket "$B" --query "{Objects: $kind[].{Key: Key, VersionId: VersionId}, Quiet: \`true\`}" --output json > /tmp/del.json
  grep -q '"Key"' /tmp/del.json && aws s3api delete-objects --bucket "$B" --delete file:///tmp/del.json
done
aws cloudformation delete-stack --region $R --stack-name travel-claims-bootstrap
aws cloudformation wait stack-delete-complete --region $R --stack-name travel-claims-bootstrap && echo "bootstrap deleted"
```

## 3. Tidy up

1. AgentCore's own log groups (a few cents):
   ```bash
   aws logs describe-log-groups --region $R --log-group-name-prefix /aws/bedrock-agentcore/ --query 'logGroups[].logGroupName' --output text | tr '\t' '\n' | grep -i travel | while read g; do aws logs delete-log-group --region $R --log-group-name "$g"; done
   ```
2. So the workflows skip their AWS jobs instead of failing: `gh variable delete PROJECT_NAME --repo euginevd/travel-claims`.
3. Revoke the Anthropic key in the Anthropic Console if you won't redeploy soon.

## 4. Verify

Every section should print nothing, or `None`:

```bash
R=ap-southeast-2; P=travel-claims; P_=travel_claims
aws cloudformation list-stacks --region $R --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE DELETE_FAILED --query "StackSummaries[?contains(StackName,'$P')].StackName" --output text
aws s3api list-buckets --query "Buckets[?contains(Name,'$P')].Name" --output text
aws s3vectors list-vector-buckets --region $R --query "vectorBuckets[?contains(vectorBucketName,'$P')].vectorBucketName" --output text
aws lambda list-functions --region $R --query "Functions[?contains(FunctionName,'$P')].FunctionName" --output text
aws ecr describe-repositories --region $R --query "repositories[?contains(repositoryName,'$P')].repositoryName" --output text
aws secretsmanager list-secrets --region $R --include-planned-deletion --query "SecretList[?contains(Name,'$P')].Name" --output text
aws cloudfront list-distributions --query "DistributionList.Items[?contains(Comment,'$P')].[Id,Status]" --output text
aws cognito-idp list-user-pools --region $R --max-results 60 --query "UserPools[?contains(Name,'$P')].Name" --output text
aws bedrock-agentcore-control list-agent-runtimes --region $R --query "agentRuntimes[?contains(agentRuntimeName,'$P_')].agentRuntimeName" --output text
aws bedrock-agentcore-control list-gateways --region $R --query "items[?contains(name,'$P')].name" --output text
aws bedrock-agentcore-control list-memories --region $R --query "memories[?contains(id,'$P_')].id" --output text
aws bedrock-agent list-knowledge-bases --region $R --query "knowledgeBaseSummaries[?contains(name,'$P')].name" --output text
aws bedrock list-guardrails --region $R --query "guardrails[?contains(name,'$P')].name" --output text
aws iam list-roles --query "Roles[?starts_with(RoleName,'$P')].RoleName" --output text
aws iam list-policies --scope Local --query "Policies[?starts_with(PolicyName,'$P')].PolicyName" --output text
aws logs describe-log-groups --region $R --query "logGroups[?contains(logGroupName,'$P') || contains(logGroupName,'$P_')].logGroupName" --output text
```

## Notes

1. **The tagging API lags.** `aws resourcegroupstaggingapi get-resources --tag-filters Key=Project,Values=travel-claims` can list deleted resources (on 2026-11-10, the three Cognito pools) for a day; trust the service's own list above.
2. **CloudFront** takes up to 15 minutes; a distribution shown as `Disabled` is still deleting.
3. **Paste commands one at a time** in CloudShell: a multi-line paste can run a later line as part of an earlier one.
4. **The OIDC provider** is one per account. If other repos' roles trust it, deploy the bootstrap with `CreateOidcProvider=false` next time, or remove the provider from the stack before deleting it.
5. **Redeploy:** set `PROJECT_NAME` to `travel-claims`, then follow [status.md](../docs/status.md) 48.
