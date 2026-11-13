"""Runs the claim agent on the evaluation set on a deployed api and fails below the baseline.
Standard library only.

UNDERCOVER_API: the api's base URL (the AWS demo, with TEST_SIGN_IN on, or a laptop).
EVAL_SIZE: tiny (the default) or whole. EVAL_GATE: the baseline file, data/evals/gate.json.

The held-out set stays the improver's exam: a person can't start a run on it, so the gate runs
the evaluation set. Exit 0 when the run meets every floor, 1 when it misses one or doesn't finish.
"""

import json
import os
import pathlib
import sys
import time
import urllib.request

POLL_SECONDS = 15
WAIT_SECONDS = 45 * 60


def call(base, method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(f"{base}{path}", data=data, method=method)  # noqa: S310
    request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310 - https or a laptop
        return json.load(response)


def misses(scores, floors):
    """Each floor the scores fall below, in words."""
    found = []
    for key, floor in floors.items():
        value = scores.get(key)
        if value is None or value < floor:
            found.append(f"{key} {value} is below the floor of {floor}")
    return found


def main():
    base = os.environ.get("UNDERCOVER_API", "http://127.0.0.1:8000").rstrip("/")
    if not base.startswith(("https://", "http://127.0.0.1", "http://localhost")):
        sys.exit("UNDERCOVER_API must be https, or the laptop")
    gate = json.loads(pathlib.Path(os.environ.get("EVAL_GATE", "data/evals/gate.json")).read_text())
    size = os.environ.get("EVAL_SIZE", "tiny")
    token = call(base, "POST", "/api/engineering/dev/test-sign-in", body={"account": "engineer"})
    token = token["id_token"]
    body = {"label_set": "evaluation", "size": size, "concurrency": 5}
    run = call(base, "POST", "/api/engineering/runs", token, body)
    run_id = run["run_id"]
    print(f"Run {run_id} started on the evaluation set ({size})")
    deadline = time.monotonic() + WAIT_SECONDS
    while run["status"] != "finished" or run.get("grading"):
        if run["status"] == "stopped" or time.monotonic() > deadline:
            print(f"Run {run_id} didn't finish: {run['status']}")
            return 1
        time.sleep(POLL_SECONDS)
        run = call(base, "GET", f"/api/engineering/runs/{run_id}", token)
    scores = run["scores"] or {}
    print(json.dumps(scores, indent=2))
    found = misses(scores, gate["floors"])
    for miss in found:
        print(f"FAIL {miss}")
    if not found:
        print("Every floor met")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
