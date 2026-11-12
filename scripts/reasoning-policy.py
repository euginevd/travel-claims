"""Keeps Ask UnderCover's Automated Reasoning check (decision 48): a policy of formal rules built
from the policy wording, and a guardrail that checks answers against it.

python3 scripts/reasoning-policy.py apply <name> <wording.md> <app-parameter>
python3 scripts/reasoning-policy.py delete <name> <app-parameter>

apply finds or creates the policy <name>, builds its rules from the wording when the wording has
changed (its hash is kept in the policy's description), prints each rule for review, versions it,
then finds or creates the guardrail <name> using that version, versions it, and writes its ID and
version into the app's settings. delete removes both and the settings. Run by the guardrail unit's
Terraform with the deploy role, through the AWS CLI, as fill-secret.py is; the Terraform provider
has no Automated Reasoning resources yet. Automated Reasoning in Sydney processes only in
Australia. A build takes several minutes.
"""

import base64
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

Json = dict[str, Any]
FILL_SECRET = Path(__file__).with_name("fill-secret.py")
KEYS = ("BEDROCK_REASONING_GUARDRAIL_ID", "BEDROCK_REASONING_GUARDRAIL_VERSION")
BUILD_MINUTES = 30
# The guardrail only reports (detect mode); these messages are never shown.
BLOCKED = "Checked against the policy's rules."
THRESHOLD = 0.8
DESCRIPTION = (
    "Travel insurance cover: plan limits, waiting periods, deductibles, what is and isn't paid,"
    " exclusions and how payouts are worked out."
)


def aws(*args: str, request: Json | None = None, check: bool = True) -> Json:
    """One Bedrock control call through the AWS CLI, with fixed arguments and no shell; a request
    goes through a private temporary file, so nothing is on a command line."""
    cli = shutil.which("aws") or sys.exit("The AWS CLI isn't installed")
    path = None
    if request is not None:
        handle, path = tempfile.mkstemp(suffix=".json")
        with os.fdopen(handle, "w", encoding="utf-8") as file:
            json.dump(request, file)
        args = (*args, "--cli-input-json", f"file://{path}")
    try:
        done = subprocess.run(  # noqa: S603
            [cli, "bedrock", *args, "--output", "json"],
            capture_output=True,
            text=True,
            check=False,
        )
    finally:
        if path:
            os.remove(path)
    if done.returncode != 0:
        if check:
            sys.exit(f"aws bedrock {args[0]} failed: {done.stderr.strip()}")
        return {"error": done.stderr}
    return json.loads(done.stdout or "{}")


def find_policy(name: str) -> Json | None:
    for policy in aws("list-automated-reasoning-policies").get(
        "automatedReasoningPolicySummaries", []
    ):
        if policy["name"] == name:
            return policy
    return None


def find_guardrail(name: str) -> Json | None:
    for guardrail in aws("list-guardrails").get("guardrails", []):
        if guardrail["name"] == name:
            return guardrail
    return None


def build(policy_arn: str, wording: str) -> Json:
    """The policy definition Automated Reasoning extracts from the wording."""
    started = aws(
        "start-automated-reasoning-policy-build-workflow",
        request={
            "policyArn": policy_arn,
            "buildWorkflowType": "INGEST_CONTENT",
            "sourceContent": {
                "workflowContent": {
                    "documents": [
                        {
                            "document": base64.b64encode(wording.encode()).decode(),
                            "documentContentType": "txt",
                            "documentName": "UnderCover policy wording",
                            "documentDescription": DESCRIPTION,
                        }
                    ]
                }
            },
        },
    )
    workflow = started["buildWorkflowId"]
    deadline = time.monotonic() + BUILD_MINUTES * 60
    while True:
        status = aws(
            "get-automated-reasoning-policy-build-workflow",
            "--policy-arn",
            policy_arn,
            "--build-workflow-id",
            workflow,
        )["status"]
        if status == "COMPLETED":
            break
        if status in ("FAILED", "CANCELLED") or time.monotonic() > deadline:
            sys.exit(f"The policy build ended {status}")
        time.sleep(20)
    assets = aws(
        "get-automated-reasoning-policy-build-workflow-result-assets",
        "--policy-arn",
        policy_arn,
        "--build-workflow-id",
        workflow,
        "--asset-type",
        "POLICY_DEFINITION",
    )
    return assets["buildWorkflowAssets"]["policyDefinition"]


def ready(guardrail_id: str) -> None:
    """Wait for a created or updated guardrail to be ready, so it can be versioned."""
    for _ in range(60):
        status = aws("get-guardrail", "--guardrail-identifier", guardrail_id)["status"]
        if status == "READY":
            return
        if status == "FAILED":
            sys.exit("The reasoning guardrail failed to build")
        time.sleep(5)
    sys.exit("The reasoning guardrail wasn't ready in five minutes")


def show(definition: Json) -> None:
    """Each rule and variable, for a person to review in the run's log."""
    rules, variables = definition.get("rules", []), definition.get("variables", [])
    print(f"Policy: {len(rules)} rules, {len(variables)} variables")
    for rule in rules:
        print(f"  rule {rule['id']}: {rule.get('alternateExpression') or rule['expression']}")
    for variable in variables:
        print(f"  variable {variable['name']} ({variable['type']}): {variable['description']}")


def apply(name: str, wording_path: str, parameter: str) -> None:
    wording = Path(wording_path).read_text(encoding="utf-8")
    digest = "wording sha256 " + hashlib.sha256(wording.encode()).hexdigest()
    policy = find_policy(name)
    if policy is None:
        policy = aws("create-automated-reasoning-policy", request={"name": name})
    arn = policy["policyArn"]
    current = aws("get-automated-reasoning-policy", "--policy-arn", arn)
    if current.get("description") != digest:
        definition = build(arn, wording)
        show(definition)
        current = aws(
            "update-automated-reasoning-policy",
            request={"policyArn": arn, "policyDefinition": definition, "description": digest},
        )
    version = aws(
        "create-automated-reasoning-policy-version",
        request={"policyArn": arn, "lastUpdatedDefinitionHash": current["definitionHash"]},
    )
    version_arn = version["policyArn"]
    if not version_arn.endswith(f":{version['version']}"):
        version_arn = f"{version_arn}:{version['version']}"
    config = {"policies": [version_arn], "confidenceThreshold": THRESHOLD}
    common = {
        "name": name,
        "description": "Ask UnderCover's answers checked against the policy wording's rules",
        "blockedInputMessaging": BLOCKED,
        "blockedOutputsMessaging": BLOCKED,
        "automatedReasoningPolicyConfig": config,
    }
    guardrail = find_guardrail(name)
    if guardrail is None:
        guardrail = aws("create-guardrail", request=common)
    else:
        aws("update-guardrail", request={"guardrailIdentifier": guardrail["id"], **common})
    guardrail_id = guardrail.get("guardrailId") or guardrail["id"]
    ready(guardrail_id)
    released = aws(
        "create-guardrail-version",
        request={"guardrailIdentifier": guardrail_id, "description": "Applied by Terraform"},
    )
    fill(
        parameter,
        [
            f"{KEYS[0]}={guardrail_id}",
            f"{KEYS[1]}={released['version']}",
        ],
    )
    print(f"{name}: policy version {version['version']}, guardrail version {released['version']}")


def delete(name: str, parameter: str) -> None:
    guardrail = find_guardrail(name)
    if guardrail is not None:
        aws("delete-guardrail", "--guardrail-identifier", guardrail["id"])
    policy = find_policy(name)
    if policy is not None:
        aws("delete-automated-reasoning-policy", "--policy-arn", policy["policyArn"], "--force")
    fill(parameter, ["--remove", *KEYS])
    print(f"{name}: deleted")


def fill(parameter: str, args: list[str]) -> None:
    done = subprocess.run(  # noqa: S603
        [sys.executable, str(FILL_SECRET), parameter, *args], check=False
    )
    if done.returncode != 0:
        sys.exit("Couldn't update the app's settings")


def main(args: list[str]) -> None:
    match args:
        case ["apply", name, wording, parameter]:
            apply(name, wording, parameter)
        case ["delete", name, parameter]:
            delete(name, parameter)
        case _:
            sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
