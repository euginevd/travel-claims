"""The AI control plane's home and its evidence: release gates for the version in use, a brief,
the controls, what needs attention, the audit log, a version's card and the agents map.

Everything here is worked out in code from records the api already keeps, never written by a
model, so no claim's words can change it. Engineers only (TB1c), read-only, except stopping a
run that has stalled.
"""

import math
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import Connection, func, insert, select, update

from undercover_api.agent_switch import AgentSwitch, agent_switch
from undercover_api.audit_chain import Anchor, ChainStatus, seal, verify
from undercover_api.auth import Database, SignedIn, SignedInEngineer
from undercover_api.budget import BUDGET_GUARD, WARN_SHARE, budget_of
from undercover_api.business_settings import accuracy_objective, straight_through_objective
from undercover_api.db import (
    assistant_calls,
    claims,
    configurations,
    decisions,
    grades,
    labelled_claims,
    model_calls,
    now,
    payments,
    redteam_reports,
    rounds,
    runs,
    setting_changes,
    steps,
)
from undercover_api.evaluations import EVALUATION, current_version
from undercover_api.kill_switch import payout_switch
from undercover_api.live import live
from undercover_api.models import PayoutSwitch, Strict
from undercover_api.pii import scrub
from undercover_api.posture import (
    Readiness,
    counts_since,
    issues_of,
    layers_of,
    report_in_use,
    since_of,
)
from undercover_api.redteam import REDTEAM_CUSTOMER
from undercover_api.success import latest_held_out_run, sign_off_criterion

assurance_router = APIRouter(prefix="/api/engineering")
staff_usage_router = APIRouter(prefix="/api/staff")

Status = Literal["pass", "watch", "fail", "none"]
# A run with no word for this long is stalled.
STALLED_AFTER = timedelta(hours=1)
Z = 1.96
# The fewest claims a gate passes on; under it the best it says is watch.
FEWEST_TO_PASS = 5


def wilson(share: float, n: int) -> tuple[float, float]:
    """Where the true share likely sits, measured on n claims (Wilson, 95%)."""
    if n <= 0:
        return (0.0, 1.0)
    share = min(1.0, max(0.0, share))
    centre = (share + Z * Z / (2 * n)) / (1 + Z * Z / n)
    half = Z * math.sqrt(share * (1 - share) / n + Z * Z / (4 * n * n)) / (1 + Z * Z / n)
    return (max(0.0, centre - half), min(1.0, centre + half))


def judged(share: float | None, n: int, target: float) -> Status:
    """Pass at or over the target; watch when the range still reaches it; fail when it can't."""
    if share is None or n == 0:
        return "none"
    if share >= target:
        # A handful of claims proves little either way: not a pass until there are enough.
        return "pass" if n >= FEWEST_TO_PASS else "watch"
    return "watch" if wilson(share, n)[1] >= target else "fail"


class Gate(BaseModel):
    key: str
    label: str
    detail: str
    status: Status
    share: float | None = None
    claims: int = 0
    target: float | None = None
    value: str
    note: str
    link: str


class Attention(BaseModel):
    kind: Literal["stalled", "review", "untested", "gap", "version"]
    text: str
    link: str
    run_ids: list[int] = []


class VersionInUse(BaseModel):
    version: int | None
    model: str | None
    effort: str | None
    since: str | None


class Overview(BaseModel):
    version: VersionInUse
    verdict: Literal["fit", "watch", "not_fit", "untested"]
    headline: str
    gates: list[Gate]
    brief: str
    agent: AgentSwitch
    payouts: PayoutSwitch
    attention: list[Attention]


def version_in_use(db: Connection) -> VersionInUse:
    current = current_version(db)
    row = (
        db.execute(select(configurations).where(configurations.c.version == current))
        .mappings()
        .first()
        if current is not None
        else None
    )
    return VersionInUse(
        version=current,
        model=row["model"] if row else None,
        effort=row["effort"] if row else None,
        since=row["created_at"] if row else None,
    )


def stalled_runs(db: Connection) -> list[int]:
    cutoff = (datetime.now(UTC) - STALLED_AFTER).isoformat(timespec="seconds")
    return list(
        db.scalars(
            select(runs.c.run_id).where(runs.c.status == "running", runs.c.started_at < cutoff)
        )
    )


def gates_of(db: Connection) -> list[Gate]:
    found: list[Gate] = []
    accuracy = accuracy_objective(db)
    exam = latest_held_out_run(db)
    scores: dict[str, Any] = exam["scores"] if exam else {}
    n = int(scores.get("claims", 0))
    share = scores.get("accuracy")
    found.append(
        Gate(
            key="held_out",
            label="Held-out accuracy",
            detail=f"{n or 25} claims the agent never learns from",
            status=judged(share, n, accuracy),
            share=share,
            claims=n,
            target=accuracy,
            value=f"{share:.0%}" if share is not None else "No exam yet",
            note=f"target {accuracy:.0%}",
            link="scoreboard",
        )
    )
    report = report_in_use(db, current_version(db))
    held = sum(r.passed for r in report.results) if report else 0
    attacks = len(report.results) if report else 0
    found.append(
        Gate(
            key="red_team",
            label="Attacks held",
            detail="OWASP LLM and agentic attacks, through the portal",
            status="none" if not report else "pass" if held == attacks else "fail",
            share=held / attacks if attacks else None,
            claims=attacks,
            value=f"{held} of {attacks}" if report else "Not run yet",
            note=f"against version {report.config_version}"
            if report and report.config_version
            else "",
            link="redteam",
        )
    )
    sign_off = sign_off_criterion(db)
    found.append(
        Gate(
            key="sign_off",
            label="No payment over the limit without a person",
            detail="checked in code on every payment",
            status="none" if sign_off.actual is None else "pass" if sign_off.met else "fail",
            value=str(int(sign_off.actual or 0)),
            note="target 0",
            link="detections",
        )
    )
    period = live(db, 14)
    decided = period.totals.decided
    # A claim sent back twice counts twice, so the share is held at zero, never below.
    kept = max(0.0, (decided - period.totals.disagreements) / decided) if decided else None
    exam_share = period.exam.accuracy if period.exam else None
    found.append(
        Gate(
            key="live_vs_exam",
            label="Live in line with the exam",
            detail="right decisions on live claims, last 14 days",
            status="none"
            if kept is None or exam_share is None
            else judged(kept, decided, exam_share - 0.1),
            share=kept,
            claims=decided,
            target=exam_share,
            value=f"{kept:.0%} live" if kept is not None else "No live claims yet",
            note=f"exam {exam_share:.0%}" if exam_share is not None else "",
            link="live",
        )
    )
    straight = straight_through_objective(db)
    alone = period.totals.straight_through_share
    found.append(
        Gate(
            key="straight_through",
            label="Decided without a person",
            detail="live, last 14 days",
            status=judged(alone, decided, straight),
            share=alone,
            claims=decided,
            target=straight,
            value=f"{alone:.0%}" if alone is not None else "No live claims yet",
            note=f"target {straight:.0%}" + (" · too few to judge" if 0 < decided < 10 else ""),  # noqa: PLR2004
            link="live",
        )
    )
    return found


def attention_of(db: Connection) -> list[Attention]:
    found: list[Attention] = []
    stalled = stalled_runs(db)
    if stalled:
        found.append(
            Attention(
                kind="stalled",
                text=f"{len(stalled)} run{'s' if len(stalled) != 1 else ''} stalled: no word for "
                "over an hour",
                link="scoreboard",
                run_ids=stalled,
            )
        )
    review = [d for d in live(db, 14).disagreements if not d.in_evaluation_set]
    if review:
        found.append(
            Attention(
                kind="review",
                text=f"{len(review)} disagreement{'s' if len(review) != 1 else ''} to review: "
                + ", ".join(d.claim_id for d in review[:3]),
                link="live",
            )
        )
    current = current_version(db)
    report = report_in_use(db, current)
    readiness = Readiness(
        payouts_paused=payout_switch(db).paused,
        live_version=current,
        tested_version=report.config_version if report else None,
        live_version_red_teamed=report is not None and report.config_version == current,
    )
    for issue in issues_of(report, layers_of(report), readiness)[:3]:
        found.append(
            Attention(
                kind="untested" if issue.severity == "high" else "gap",
                text=issue.title,
                link="posture" if issue.link == "coverage" else issue.link,
            )
        )
    candidate = db.scalar(
        select(configurations.c.version).where(configurations.c.status == "candidate")
    )
    if candidate is not None:
        found.append(
            Attention(
                kind="version",
                text=f"Agent version {candidate}, the improver's latest, is being tested",
                link="improvement",
            )
        )
    return found


def brief_of(gates: list[Gate], attention: list[Attention], version: VersionInUse) -> str:
    v = f"Agent version {version.version}" if version.version is not None else "The agent"
    failing = [g.label.lower() for g in gates if g.status == "fail"]
    missing = [g for g in gates if g.status == "none"]
    if failing:
        first = f"{v} fails on {', '.join(failing)}."
    elif missing:
        first = f"{v} can't be judged yet: {', '.join(g.label.lower() for g in missing[:2])}."
    else:
        first = f"{v} holds on every gate it has evidence for."
    nexts = {
        "stalled": "stop the stalled runs",
        "review": "review the disagreements",
        "version": "run the red team against the version being tested",
        "untested": "run the red team",
        "gap": "add an attack for an untested risk",
    }
    todo = next((nexts[a.kind] for a in attention), None)
    if any(g.key == "held_out" and g.status == "none" for g in gates):
        todo = "run the exam"
    return f"{first} Next: {todo}." if todo else first


@assurance_router.get("/overview", operation_id="get_overview")
def get_overview(_: SignedInEngineer, db: Database) -> Overview:
    """Is the agent fit to run: five gates, a brief, the controls and what needs attention."""
    gates = gates_of(db)
    attention = attention_of(db)
    version = version_in_use(db)
    statuses = {g.key: g.status for g in gates}
    v = f"Agent version {version.version}" if version.version is not None else "The agent"
    missing = [
        what
        for key, what in (("held_out", "exam"), ("red_team", "red-team run"))
        if statuses[key] == "none"
    ]
    lower = v[0].lower() + v[1:]
    if "fail" in statuses.values():
        failing = [g.label.lower() for g in gates if g.status == "fail"]
        verdict, headline = (
            "not_fit",
            f"Not fit to run: {lower} fails on {', '.join(failing)}.",
        )
    elif missing:
        verdict = "untested"
        headline = f"Not judged yet: {lower} has no {' or '.join(missing)}."
    elif any(s in ("watch", "none") for s in statuses.values()):
        passed = list(statuses.values()).count("pass")
        verdict = "watch"
        headline = f"Probably fit: {lower} passes {passed} of {len(gates)} gates; watch the rest."
    else:
        verdict, headline = (
            "fit",
            f"Fit to run: {lower} passes all {len(gates)} gates.",
        )
    return Overview(
        version=version,
        verdict=verdict,
        headline=headline,
        gates=gates,
        brief=brief_of(gates, attention, version),
        agent=agent_switch(db),
        payouts=payout_switch(db),
        attention=attention,
    )


class Controls(BaseModel):
    agent: AgentSwitch
    payouts: PayoutSwitch


@assurance_router.get("/controls", operation_id="get_controls")
def get_controls(_: SignedInEngineer, db: Database) -> Controls:
    """The agent and payouts switches for the header on every page; read-only here."""
    return Controls(agent=agent_switch(db), payouts=payout_switch(db))


class Alert(BaseModel):
    severity: Literal["high", "medium"]
    text: str
    link: str


# A guardrail firing this many times today, and this many times its daily average, is unusual.
SPIKE_AT_LEAST = 3
SPIKE_TIMES = 3


def alerts_of(db: Connection, anchor: Anchor | None = None) -> list[Alert]:
    """What needs an engineer now: a failing gate, the budget, a guardrail spike, the output
    guard, false alarms and stalled runs. Worked out in code, never by a model."""
    found: list[Alert] = [
        Alert(
            severity="high", text=f"The agent fails its gate: {gate.label.lower()}", link="overview"
        )
        for gate in gates_of(db)
        if gate.status == "fail"
    ]
    budget = budget_of(db)
    switch = agent_switch(db)
    if not switch.on and switch.changed_by == BUDGET_GUARD:
        found.append(
            Alert(severity="high", text=f"The agent stopped: {switch.reason}", link="budgets")
        )
    elif budget.share >= WARN_SHARE:
        found.append(
            Alert(
                severity="medium",
                text=f"{round(budget.share * 100)}% of today's ${budget.limit:,.2f} budget spent",
                link="budgets",
            )
        )
    today = counts_since(db, since_of(1))
    fortnight = counts_since(db, since_of(14))
    for kind, hits in today.items():
        usual = fortnight[kind] / 14
        if kind != "held" and hits >= SPIKE_AT_LEAST and hits >= SPIKE_TIMES * max(usual, 1):
            found.append(
                Alert(
                    severity="medium",
                    text=f"Unusual: {hits} {kind.replace('_', '-')} hits today, about "
                    f"{round(usual, 1)} a day usually",
                    link="guardrails",
                )
            )
    if today.get("output", 0):
        found.append(
            Alert(
                severity="medium",
                text=f"The output guard removed personal data {today['output']} "
                f"{'time' if today['output'] == 1 else 'times'} today",
                link="guardrails",
            )
        )
    from undercover_api.trends import agent_trends  # noqa: PLC0415 - trends imports live, which imports this

    found.extend(
        Alert(
            severity="medium",
            text=f"Unusual: {trend.label} made {trend.today} model calls today, about "
            f"{trend.usual} a day usually",
            link="live",
        )
        for trend in agent_trends(db)
        if trend.unusual
    )
    chain = chain_status(db, anchor)
    if anchor is not None and chain.sealed and not chain.anchored:
        # Configured but unreadable (a refused write, an outage): said, never passed over.
        found.append(
            Alert(
                severity="medium",
                text="The audit seals have no write-once copy to check against",
                link="audit",
            )
        )
    if not chain.intact:
        found.append(
            Alert(
                severity="high",
                text=f"The audit log changed after it was sealed: "
                f"{len(chain.changed) + len(chain.missing)} records",
                link="audit",
            )
        )
    found.extend(
        Alert(severity="medium", text=item.text, link="scoreboard")
        for item in attention_of(db)
        if item.kind == "stalled"
    )
    return found


@assurance_router.get("/alerts", operation_id="list_alerts")
def get_alerts(_: SignedInEngineer, db: Database, http: Request) -> list[Alert]:
    """What needs an engineer now, most urgent first."""
    return sorted(alerts_of(db, anchor_of(http)), key=lambda a: a.severity != "high")


@assurance_router.post("/runs/{run_id}/stop", operation_id="stop_stalled_run")
def stop_run(run_id: int, engineer: SignedInEngineer, db: Database) -> dict[str, int]:
    """Mark a run that has stalled as stopped; its copies are never paid either way."""
    if run_id not in stalled_runs(db):
        raise HTTPException(409, f"Run {run_id} isn't stalled")
    db.execute(
        update(runs)
        .where(runs.c.run_id == run_id)
        .values(status="stopped", finished_at=datetime.now(UTC).isoformat(timespec="seconds"))
    )
    db.execute(
        setting_changes.insert().values(
            key="run_stopped",
            value={"run_id": run_id},
            changed_by=engineer.name,
            changed_by_id=engineer.engineer_id,
            changed_at=datetime.now(UTC).isoformat(timespec="seconds"),
            reason="Stalled",
        )
    )
    return {"run_id": run_id}


# --- Audit log ---

AuditKind = Literal["switch", "setting", "decision", "version", "evaluation", "reset"]
KEY_KINDS: dict[str, AuditKind] = {
    "agent_switch": "switch",
    "payouts_paused": "switch",
    "demo_reset": "reset",
    "run_stopped": "reset",
}
KEY_LABELS = {
    "agent_switch": "Agent switch",
    "payouts_paused": "Payouts",
    "demo_reset": "Demo reset",
    "run_stopped": "Run stopped",
    "approval_limit": "Approval limit",
    "round_spend_limit": "Improvement budget",
    "accuracy_objective": "Accuracy target",
    "straight_through_objective": "Decided-alone target",
    "agents_at_once": "Claims worked at once",
    "agent_daily_budget": "Daily budget",
}


class AuditEntry(BaseModel):
    ref: str = Field(description="Which record it comes from, for its seal")
    at: str
    kind: AuditKind
    label: str
    change: str
    before: str | None = Field(default=None, description="What it was before, when known")
    reason: str | None
    by: str


def _fields(value: object) -> dict[str, object]:
    """A stored JSON object's fields, typed; anything else has none."""
    return cast("dict[str, object]", value) if isinstance(value, dict) else {}


def _said(value: object) -> str:
    fields = _fields(value)
    if not fields:
        return "" if value is None else str(value)
    parts: list[str] = []
    for k, v in fields.items():
        if k == "reason":
            continue
        shown = ("yes" if v else "no") if isinstance(v, bool) else str(v)
        parts.append(f"{k.replace('_', ' ')}: {shown}")
    return ", ".join(parts)


def _switch_words(key: str, value: object) -> str:
    fields = _fields(value)
    if key == "agent_switch":
        return "on" if fields.get("on") is True else "off"
    if key == "payouts_paused":
        return "paused" if fields.get("paused") is True else "live"
    if key == "demo_reset":
        return "cleared " + ", ".join(k.replace("_", " ") for k, v in fields.items() if v is True)
    return _said(value)


def _words(kind: AuditKind, key: str, value: object) -> str:
    return _said(value) if kind == "setting" else _switch_words(key, value)


def audit(db: Connection, limit: int = 100) -> list[AuditEntry]:
    found: list[AuditEntry] = []
    for row in db.execute(
        select(setting_changes).order_by(setting_changes.c.change_id.desc()).limit(limit)
    ).mappings():
        key = str(row["key"])
        value: object = row["value"]
        kind = KEY_KINDS.get(key, "setting")
        reason: str | None = row["reason"]
        said = _fields(value).get("reason")
        if reason is None and isinstance(said, str):
            reason = said
        old: object = row["old_value"]
        found.append(
            AuditEntry(
                ref=f"setting:{row['change_id']}",
                at=row["changed_at"],
                kind=kind,
                label=KEY_LABELS.get(key, key.replace("_", " ")),
                change=_words(kind, key, value),
                before=_words(kind, key, old) if old is not None and kind != "reset" else None,
                reason=reason,
                by=row["changed_by"],
            )
        )
    for row in db.execute(
        select(decisions.c.claim_id, decisions.c.decision, decisions.c.payout, decisions.c.override)
        .where(decisions.c.override.is_not(None))
        .limit(limit)
    ).mappings():
        o: dict[str, Any] = row["override"]
        was = o.get("previous_decision")
        now = row["decision"] + (f" ${row['payout']:,.2f}" if row["decision"] == "approve" else "")
        found.append(
            AuditEntry(
                ref=f"override:{row['claim_id']}",
                at=str(o.get("at", "")),
                kind="decision",
                label=row["claim_id"],
                change=now,
                before=str(was) if was else None,
                reason=scrub(f"{o.get('reason_code', '')}: {o.get('note', '')}".strip(": "))[0],
                by=str(o.get("by", "")),
            )
        )
    for row in db.execute(
        select(configurations).where(configurations.c.version > 1).limit(limit)
    ).mappings():
        found.append(
            AuditEntry(
                ref=f"version:{row['version']}",
                at=row["created_at"],
                kind="version",
                label=f"Version {row['version']}",
                change=f"{row['model'].replace('claude-', '')}, {row['effort']} · {row['status']}",
                reason=row["reason"],
                by=row["reviewed_by"] or row["proposed_by"],
            )
        )
    for row in db.execute(
        select(labelled_claims).where(labelled_claims.c.added_by.is_not(None)).limit(limit)
    ).mappings():
        label: dict[str, Any] = row["label"]
        found.append(
            AuditEntry(
                ref=f"evaluation:{row['claim_id']}",
                at=row["added_at"],
                kind="evaluation",
                label=row["claim_id"],
                change=f"added, label: {label.get('decision', '')}",
                reason="from the disagreements to review",
                by=row["added_by"],
            )
        )
    found.sort(key=lambda entry: entry.at, reverse=True)
    return found[:limit]


# Enough to seal and check every entry, not just the page's newest.
EVERY_ENTRY = 100_000


def chain_status(db: Connection, anchor: Anchor | None = None) -> ChainStatus:
    """Seal what's new, then check every seal against the records as they are now, and the
    newest against its write-once copy when there is one."""
    entries = audit(db, limit=EVERY_ENTRY)
    seal(db, entries, anchor)
    return verify(db, entries, anchor)


def anchor_of(http: Request) -> Anchor | None:
    found: Anchor | None = getattr(http.app.state, "audit_anchor", None)
    return found


@assurance_router.get("/audit", operation_id="get_audit_log")
def get_audit(_: SignedInEngineer, db: Database) -> list[AuditEntry]:
    """Every switch, setting, override, reset, version and evaluation-set addition, newest first."""
    return audit(db)


@assurance_router.get("/audit/chain", operation_id="check_audit_chain")
def get_audit_chain(_: SignedInEngineer, db: Database, http: Request) -> ChainStatus:
    """Seal the new entries and check the chain: intact, or which records changed after."""
    return chain_status(db, anchor_of(http))


# --- Assistants' answers, for the agents map ---


class AssistantTurn(Strict):
    model_calls: int = Field(ge=0, le=200)
    cost: float = Field(ge=0, le=10)


@staff_usage_router.post("/assistant-calls", operation_id="record_copilot_turn", status_code=201)
def record_copilot_turn(turn: AssistantTurn, _: SignedIn, db: Database) -> dict[str, bool]:
    """The Copilot's turn for a signed-in handler: counted on the agents map, nothing else."""
    db.execute(
        insert(assistant_calls).values(
            agent="copilot", model_calls=turn.model_calls, cost=turn.cost, created_at=now()
        )
    )
    return {"counted": True}


def assistant_counts(db: Connection, agent: str, since: str) -> tuple[int, int, float]:
    """An assistant's answers, model calls and cost since a day."""
    answers, calls, cost = db.execute(
        select(
            func.count(assistant_calls.c.call_id),
            func.sum(assistant_calls.c.model_calls),
            func.sum(assistant_calls.c.cost),
        ).where(assistant_calls.c.agent == agent, assistant_calls.c.created_at >= since)
    ).one()
    return int(answers), int(calls or 0), float(cost or 0)


# --- A version's card ---


class VersionScores(BaseModel):
    run_id: int
    claims: int
    accuracy: float
    payout_accuracy: float
    straight_through: float
    grade: float | None
    cost_per_claim: float
    seconds_per_claim: float


class VersionCard(BaseModel):
    version: int
    title: str
    model: str
    effort: str
    status: str
    in_use: bool
    reason: str
    diff: str
    parent_version: int | None
    proposed_by: str
    reviewed_by: str | None
    created_at: str
    exam: VersionScores | None
    red_team: str | None
    tools: list[str]


# Cheapest first: a move down this list is a cheaper model, up it a stronger one.
MODEL_RANK = {"haiku": 1, "sonnet": 2, "opus": 3}


def model_word(model: str) -> str:
    """ "claude-haiku-5-5" as people say it: "Haiku"."""
    parts = model.split("-")
    return parts[1].capitalize() if len(parts) > 1 and parts[0] == "claude" else model


def title_of(row: dict[str, Any], parent: dict[str, Any] | None) -> str:
    """What a version changed, in a few words, worked out from the records, never by a model:
    "Cheaper model: Sonnet → Haiku", "Lower effort: medium → low", "New instructions"."""
    if parent is None:
        return "First version"
    changes: list[str] = []
    before, after = model_word(parent["model"]), model_word(row["model"])
    if before != after:
        cheaper = MODEL_RANK.get(after.lower(), 0) < MODEL_RANK.get(before.lower(), 0)
        changes.append(f"{'Cheaper' if cheaper else 'Stronger'} model: {before} → {after}")
    efforts = ["low", "medium", "high"]
    if parent["effort"] != row["effort"]:
        lower = (
            efforts.index(row["effort"]) < efforts.index(parent["effort"])
            if (row["effort"] in efforts and parent["effort"] in efforts)
            else False
        )
        changes.append(
            f"{'Lower' if lower else 'Higher'} effort: {parent['effort']} → {row['effort']}"
        )
    edited = [
        line
        for line in (row["diff"] or "").splitlines()
        if line[:1] in "+-"
        and not line.startswith(("+++", "---"))
        and not line[1:].startswith(("model:", "effort:"))
        and line[1:].strip()
    ]
    if edited:
        changes.append("New instructions")
    return " + ".join(changes) or f"Same as #{parent['version']}"


def card_of(db: Connection, row: dict[str, Any], in_use: int | None) -> VersionCard:
    """What a version is, and the evidence for it: its latest exam and the red team against it."""
    version = row["version"]
    parent = (
        db.execute(select(configurations).where(configurations.c.version == row["parent_version"]))
        .mappings()
        .first()
        if row["parent_version"] is not None
        else None
    )
    exam = (
        db.execute(
            select(runs)
            # The exam is the held-out run: a shadow test's scores are never shown as it.
            .where(
                runs.c.config_version == version,
                runs.c.status == "finished",
                runs.c.label_set == "held_out",
            )
            .order_by(runs.c.run_id.desc())
            .limit(1)
        )
        .mappings()
        .first()
    )
    scores: dict[str, Any] = exam["scores"] if exam and exam["scores"] else {}
    report = report_in_use(db, version)
    tested = report is not None and report.config_version == version
    return VersionCard(
        version=version,
        title=title_of(dict(row), dict(parent) if parent else None),
        model=row["model"],
        effort=row["effort"],
        status=row["status"],
        in_use=in_use == version,
        reason=row["reason"],
        diff=row["diff"],
        parent_version=row["parent_version"],
        proposed_by=row["proposed_by"],
        reviewed_by=row["reviewed_by"],
        created_at=row["created_at"],
        exam=VersionScores(
            run_id=exam["run_id"],
            claims=int(scores.get("claims", 0)),
            accuracy=float(scores.get("accuracy", 0)),
            payout_accuracy=float(scores.get("payout_accuracy", 0)),
            straight_through=float(scores.get("straight_through", 0)),
            grade=scores.get("grade"),
            cost_per_claim=float(scores.get("cost_per_claim", 0)),
            seconds_per_claim=float(scores.get("seconds_per_claim", 0)),
        )
        if exam and scores
        else None,
        red_team=(
            f"Stopped {sum(r.passed for r in report.results)} of {len(report.results)} attacks"
            if report and tested
            else None
        ),
        tools=[
            "get_claim",
            "get_policy",
            "get_claim_history",
            "calculate_payout",
            "find_duplicate_receipts",
            "search_memory",
            "record_decision",
        ],
    )


@assurance_router.get("/versions", operation_id="list_version_cards")
def list_versions(_: SignedInEngineer, db: Database) -> list[VersionCard]:
    """Every version, newest first, each with what it changed and its evidence."""
    in_use = current_version(db)
    rows = (
        db.execute(select(configurations).order_by(configurations.c.version.desc()))
        .mappings()
        .all()
    )
    return [card_of(db, dict(row), in_use) for row in rows]


@assurance_router.get("/versions/{version}", operation_id="get_version_card")
def get_version(version: int, _: SignedInEngineer, db: Database) -> VersionCard:
    """What a version is, and the evidence for it."""
    row = (
        db.execute(select(configurations).where(configurations.c.version == version))
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(404, f"No version {version}")
    return card_of(db, dict(row), current_version(db))


# --- The agents map ---


class AgentNode(BaseModel):
    key: str
    label: str
    model: str | None
    who: Literal["customer", "handler", "engineer", "system"]
    calls: int
    detail: str
    working: int = 0
    failed: int = 0


class AgentsMap(BaseModel):
    days: int
    agent_on: bool
    payouts_paused: bool
    claim_agent_model: str | None
    nodes: list[AgentNode]


def _count(db: Connection, query: Any) -> int:
    return int(db.scalar(select(func.count()).select_from(query.subquery())) or 0)


@assurance_router.get("/agents", operation_id="get_agents_map")
def get_agents(
    _: SignedInEngineer, db: Database, days: Annotated[int, Query(ge=1, le=90)] = 14
) -> AgentsMap:
    """Every agent and how much each has done in the period, worked out from the records."""
    since = (datetime.now(UTC) - timedelta(days=days)).isoformat(timespec="seconds")
    live_claim = (claims.c.source != EVALUATION) & (claims.c.customer_id != REDTEAM_CUSTOMER)
    live_ids = select(claims.c.claim_id).where(live_claim)
    wattle = assistant_counts(db, "wattle", since)
    copilot = assistant_counts(db, "copilot", since)

    def step_count(*where: Any) -> int:
        return _count(
            db,
            select(steps.c.step_id).where(
                steps.c.created_at >= since, steps.c.claim_id.in_(live_ids), *where
            ),
        )

    screened = step_count(steps.c.kind == "screening")
    flagged = step_count(steps.c.kind == "screening", steps.c.content.like("Instructions found%"))
    specialists = step_count(
        steps.c.kind == "tool_call",
        steps.c.content.like("check_documents%")
        | steps.c.content.like("review_medical%")
        | steps.c.content.like("find_duplicate_receipts%"),
    )
    errors = step_count(steps.c.kind == "error")
    agent_calls = _count(
        db,
        select(model_calls.c.call_id).where(
            model_calls.c.created_at >= since, model_calls.c.claim_id.in_(live_ids)
        ),
    )
    decided = _count(
        db,
        select(decisions.c.claim_id).where(
            decisions.c.decided_at >= since, decisions.c.claim_id.in_(live_ids)
        ),
    )
    paid = _count(db, select(payments.c.claim_id).where(payments.c.paid_at >= since))
    signed = _count(
        db,
        select(payments.c.claim_id).where(
            payments.c.paid_at >= since, payments.c.signed_off_by.is_not(None)
        ),
    )
    held = _count(
        db, select(claims.c.claim_id).where(live_claim, claims.c.status == "waiting_for_sign_off")
    )
    working = _count(
        db, select(claims.c.claim_id).where(live_claim, claims.c.status == "in_progress")
    )
    made = _count(
        db,
        select(claims.c.claim_id).where(
            live_claim, claims.c.source == "customer", claims.c.ready_at >= since
        ),
    )
    graded = _count(db, select(grades.c.claim_id).where(grades.c.graded_at >= since))
    rounds_run = _count(db, select(rounds.c.round_id).where(rounds.c.started_at >= since))
    attacks = _count(
        db, select(redteam_reports.c.report_id).where(redteam_reports.c.run_at >= since)
    )
    version = version_in_use(db)
    agent = agent_switch(db)
    nodes = [
        AgentNode(
            key="portal",
            label="Customer portal",
            model=None,
            who="customer",
            calls=made,
            detail=f"{made} claims made",
        ),
        AgentNode(
            key="drafting",
            label="Drafting assistant",
            model="claude-haiku-5-5",
            who="customer",
            calls=made,
            detail="drafts each claim from the customer's words",
        ),
        AgentNode(
            key="wattle",
            label="Wattle",
            model="claude-haiku-5-5",
            who="customer",
            calls=wattle[1],
            detail=f"{wattle[0]} questions answered, citing the policy",
        ),
        AgentNode(
            key="api",
            label="API",
            model=None,
            who="system",
            calls=decided,
            detail="checks every decision and works out every payout",
        ),
        AgentNode(
            key="screening",
            label="Hidden-instruction check",
            model="claude-haiku-5-5",
            who="system",
            calls=screened,
            detail=f"{screened} claims read, {flagged} stopped",
            failed=flagged,
        ),
        AgentNode(
            key="claim_agent",
            label="Claim agent",
            model=version.model,
            who="system",
            calls=agent_calls,
            detail=f"{decided} decided, {agent_calls} model calls",
            working=working,
            failed=errors,
        ),
        AgentNode(
            key="specialists",
            label="Specialists",
            model="claude-haiku-5-5",
            who="system",
            calls=specialists,
            detail="document checker, medical reviewer, duplicate check",
        ),
        AgentNode(
            key="context",
            label="Context (MCP)",
            model=None,
            who="system",
            calls=agent_calls,
            detail="policy wording, claims manual, plans",
        ),
        AgentNode(
            key="payout",
            label="Payout code",
            model=None,
            who="system",
            calls=paid,
            detail=f"{paid} paid, {held} held for sign-off",
        ),
        AgentNode(
            key="sign_off",
            label="Senior sign-off",
            model=None,
            who="handler",
            calls=signed,
            detail=f"{signed} signed off, {held} waiting",
            working=held,
        ),
        AgentNode(
            key="copilot",
            label="Copilot",
            model="claude-sonnet-5-5",
            who="handler",
            calls=copilot[1],
            detail=f"{copilot[0]} turns, ${copilot[2]:,.2f}; acts only after a confirm card",
        ),
        AgentNode(
            key="judge",
            label="Judge",
            model="claude-haiku-5-5",
            who="engineer",
            calls=graded,
            detail=f"{graded} explanations graded",
        ),
        AgentNode(
            key="improver",
            label="Improver",
            model="claude-sonnet-5-5",
            who="engineer",
            calls=rounds_run,
            detail=f"{rounds_run} rounds",
        ),
        AgentNode(
            key="red_team",
            label="Red team",
            model="claude-haiku-5-5",
            who="engineer",
            calls=attacks,
            detail=f"{attacks} runs",
        ),
    ]
    return AgentsMap(
        days=days,
        agent_on=agent.on,
        payouts_paused=payout_switch(db).paused,
        claim_agent_model=version.model,
        nodes=nodes,
    )
