#!/usr/bin/env bash
# Makes a fresh access key for the bootstrap's travel-claims-cli user, which can only assume the read-only
# troubleshoot role (decision 46), replacing any old one. Paste it into AWS CloudShell, signed in as an admin.
# It prints the commands to paste into your own terminal: the key is shown once, so don't paste it into a chat.
{
  U=travel-claims-cli
  if ! aws iam get-user --user-name $U >/dev/null 2>&1; then
    echo "No $U user: update the bootstrap stack with the current bootstrap.yaml first."
  else
    for k in $(aws iam list-access-keys --user-name $U --query 'AccessKeyMetadata[].AccessKeyId' --output text); do
      aws iam delete-access-key --user-name $U --access-key-id "$k" && echo "Deleted the old key $k"
    done
    read -r id secret < <(aws iam create-access-key --user-name $U \
      --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)
    echo
    echo "Paste these three lines into a terminal on your machine (Git Bash or PowerShell):"
    echo
    echo "aws configure set aws_access_key_id $id --profile $U"
    echo "aws configure set aws_secret_access_key $secret --profile $U"
    echo "aws sts get-caller-identity --profile travel-claims-troubleshoot"
    echo
    echo "The last line should name the role travel-claims-troubleshoot. Then clear this screen: clear"
    unset id secret
  fi
}
