"""Security posture for the AI engineers' console, worked out in code from records the api
already keeps: where the latest red-team run's attacks were stopped, how much of the threat
catalogue is tested, which controls fired on live claims, and the gaps to close first.

The posture reads only red-team runs against the claim agent version in use (or untagged older
runs), never a candidate's. Detections are read from live claims only (never an evaluation copy or
a red-team claim), once per claim and control. A detection's summary is the check's own reason:
untrusted model output that may quote the claim, shown as plain text and never sent to a model.
Nothing here changes anything.
"""

from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import ColumnElement, Connection, and_, func, not_, or_, select

from undercover_api.auth import Database, SignedInEngineer
from undercover_api.db import claims, decisions, redteam_reports, steps
from undercover_api.evaluations import current_version
from undercover_api.kill_switch import payout_switch
from undercover_api.live import FLAGGED, LIVE
from undercover_api.models import SCREENING_MAKER, DecisionKind, RedTeamReport, RedTeamResult
from undercover_api.threats import AGENTS, CATALOGUE

posture_router = APIRouter(prefix="/api/engineering")

Days = Annotated[int, Query(ge=1, le=90)]
Severity = Literal["high", "medium", "low"]
Kind = Literal["guardrail", "hidden_instruction", "refusal", "held", "output", "guardian"]
# The step the output guard writes when it removes personal data from the agent's words.
OUTPUT_CHECK = "output_check"
LayerKey = Literal["screening", "agent", "limits", "sign_off"]
Verdict = Literal["untested", "failing", "gap", "holding"]
POSTURE_DAYS = 14
MOST_EVENTS = 200
# How a screening step reads when the guardrail, not the check, referred the claim: a block, or
# the guardrail failing closed.
# The guardrail's own reasons start the screening step's text, right after the verdict, so a
# claim that merely quotes these words is never counted as the guardrail's.
GUARDRAIL_REASONS = (
    f"{FLAGGED}. The Bedrock guardrail %",
    f"{FLAGGED}. The guardrail couldn't check%",
)
HELD = "Held for sign-off"
# Risks a build check covers rather than an attack: no gap when nothing attacks them.
BUILD_CHECKED = {"LLM03"}

# Each layer an attack meets, in order: (key, name, what it does). The guardrail and the check
# are one layer here: a red-team result records either as the check's referral.
LAYERS: tuple[tuple[LayerKey, str, str], ...] = (
    (
        "screening",
        "Guardrail and hidden-instruction check",
        "On AWS a Bedrock guardrail, then a separate model, reads every claim and receipt "
        "before the agent",
    ),
    (
        "agent",
        "Claim agent",
        "Its tools take the claim and customer from the session, never from the model",
    ),
    (
        "limits",
        "Limits in code",
        "The payout is worked out from the receipts; over the approval limit is held",
    ),
    ("sign_off", "A person signs off", "A senior handler approves every held payout"),
)
CONTROLS: dict[Kind, str] = {
    "guardrail": "Bedrock guardrail",
    "hidden_instruction": "Hidden-instruction check",
    "refusal": "Model refused",
    "held": "Payout held",
    "output": "Output guard",
    "guardian": "Guardian",
}
OUTCOMES: dict[Kind, str] = {
    "guardrail": "Referred to a handler unseen",
    "hidden_instruction": "Referred to a handler unseen",
    "refusal": "The agent stopped",
    "held": "Held for a senior handler",
    "output": "Personal data removed",
    "guardian": "Held for a senior handler",
}
SEVERITY_ORDER: dict[Severity, int] = {"high": 0, "medium": 1, "low": 2}


class Layer(BaseModel):
    key: LayerKey
    name: str
    what: str
    reached: int
    stopped: int


class Inventory(BaseModel):
    agents: int
    models: int
    risks: int
    live_version: int | None


class Controls(BaseModel):
    risks: int
    with_control: int
    tested: int
    llm_tested: int
    llm_total: int
    agentic_tested: int
    agentic_total: int


class Issue(BaseModel):
    severity: Severity
    title: str
    detail: str
    link: Literal["redteam", "coverage"]


class Readiness(BaseModel):
    payouts_paused: bool
    live_version: int | None
    tested_version: int | None
    live_version_red_teamed: bool


class RedTeamSummary(BaseModel):
    run_at: str
    run_by: str
    config_version: int | None
    attacks: int
    held: int
    paid: float


class Detection(BaseModel):
    kind: Kind
    control: str
    claim_id: str
    at: str
    summary: str
    outcome: str
    # What a person did after: approved, declined, signed off, or still waiting.
    after: str | None = None


Where = Literal["Input", "Model", "Action", "Tool", "Person", "Output"]


class Guardrail(BaseModel):
    """One protection: where it sits, what it does, whether it's on, and its evidence."""

    key: str
    name: str
    where: Where
    does: str
    mode: Literal["Enforcing", "On AWS", "Built in", "Missing"]
    hits: int | None
    stopped: int | None
    reached: int | None
    false_alarms: int | None


class Detections(BaseModel):
    days: int
    since: str
    counts: dict[Kind, int]
    events: list[Detection]
    guardrails: list[Guardrail] = []
    red_teamed: bool = False


class Posture(BaseModel):
    verdict: Verdict
    redteam: RedTeamSummary | None
    layers: list[Layer]
    inventory: Inventory
    controls: Controls
    issues: list[Issue]
    detections: dict[Kind, int]
    detection_days: int
    readiness: Readiness


# --- Layers ---


def stopped_at(result: RedTeamResult) -> LayerKey | None:
    """The layer that stopped an attack, or None when it got through."""
    if not result.passed:
        return None
    if result.outcome.startswith(HELD):
        return "limits"
    if result.decided_by == SCREENING_MAKER:
        return "screening"
    # Declined, referred or paid only what the claim supports: the agent held.
    return "agent"


def layers_of(report: RedTeamReport | None) -> list[Layer]:
    """Each layer with how many attacks reached it and how many it stopped."""
    stops = [stopped_at(r) for r in report.results] if report else []
    left = len(stops)
    found: list[Layer] = []
    for key, name, what in LAYERS:
        stopped = stops.count(key)
        found.append(Layer(key=key, name=name, what=what, reached=left, stopped=stopped))
        left -= stopped
    return found


# --- Coverage and gaps ---


def tested_risks(report: RedTeamReport | None) -> set[str]:
    ids: set[str] = set()
    for result in report.results if report else []:
        ids.update(part.strip() for part in result.owasp.split(","))
    return ids


def controls_of(report: RedTeamReport | None) -> Controls:
    tested = tested_risks(report)
    ids = [row[0] for row in CATALOGUE]
    llm = [i for i in ids if i.startswith("LLM")]
    agentic = [i for i in ids if i.startswith("ASI")]
    return Controls(
        risks=len(ids),
        with_control=sum(1 for row in CATALOGUE if row[3].strip()),
        tested=sum(1 for i in ids if i in tested),
        llm_tested=sum(1 for i in llm if i in tested),
        llm_total=len(llm),
        agentic_tested=sum(1 for i in agentic if i in tested),
        agentic_total=len(agentic),
    )


def issues_of(
    report: RedTeamReport | None, layers: list[Layer], readiness: Readiness
) -> list[Issue]:
    """The gaps to close, most severe first."""
    if report is None:
        return [
            Issue(
                severity="high",
                title="The red team hasn't run",
                detail="No attack has tested any layer yet.",
                link="redteam",
            )
        ]
    found = [
        Issue(
            severity="high",
            title=f"{r.attack_id} got through: {r.name}",
            detail=r.note,
            link="redteam",
        )
        for r in report.results
        if not r.passed
    ]
    if all(layer.reached == 0 for layer in layers[1:]) and not found:
        found.append(
            Issue(
                severity="high",
                title="The layers behind the hidden-instruction check have never faced an attack",
                detail=(
                    "Every attack was stopped first, so what the claim agent, the payout code and "
                    "a sign-off would do is untested."
                ),
                link="redteam",
            )
        )
    if not readiness.live_version_red_teamed and readiness.live_version is not None:
        found.append(
            Issue(
                severity="low",
                title=f"Agent version {readiness.live_version} is in use without a red-team run",
                detail="Run the red team to test the version handling claims now.",
                link="redteam",
            )
        )
    tested = tested_risks(report)
    found.extend(
        Issue(
            severity="medium",
            title=f"No attack tests {owasp} {risk.lower()}",
            detail=f"The control: {control}.",
            link="coverage",
        )
        for owasp, risk, _, control, _ in CATALOGUE
        if owasp not in tested and owasp not in BUILD_CHECKED
    )
    return sorted(found, key=lambda issue: SEVERITY_ORDER[issue.severity])


def verdict_of(report: RedTeamReport | None, issues: list[Issue]) -> Verdict:
    if report is None:
        return "untested"
    if any(not r.passed for r in report.results):
        return "failing"
    if any(issue.severity != "low" for issue in issues):
        return "gap"
    return "holding"


# --- Detections ---


def since_of(days: int) -> str:
    today = datetime.now(UTC).date()
    return (today - timedelta(days=days - 1)).isoformat()


def screened(guardrail: bool) -> ColumnElement[bool]:
    """A live claim the screening step flagged: by the guardrail, or by the check."""
    by_guardrail = or_(*(steps.c.content.like(words) for words in GUARDRAIL_REASONS))
    return and_(
        *LIVE,
        steps.c.kind == "screening",
        steps.c.content.like(f"{FLAGGED}%"),
        by_guardrail if guardrail else not_(by_guardrail),
    )


def refused() -> ColumnElement[bool]:
    return and_(*LIVE, steps.c.kind == "refusal")


def guarded_by_guardian() -> ColumnElement[bool]:
    return and_(*LIVE, steps.c.kind == "guardian")


def output_checked() -> ColumnElement[bool]:
    return and_(*LIVE, steps.c.kind == OUTPUT_CHECK)


def held() -> ColumnElement[bool]:
    """An approval over the limit waits for a sign-off; a hold reason is any other hold."""
    return and_(
        *LIVE,
        decisions.c.decision == DecisionKind.APPROVE,
        or_(decisions.c.payout > decisions.c.approval_limit, decisions.c.hold_reason.is_not(None)),
    )


STEPS = steps.join(claims, claims.c.claim_id == steps.c.claim_id)
DECISIONS = decisions.join(claims, claims.c.claim_id == decisions.c.claim_id)


def counts_since(db: Connection, since: str) -> dict[Kind, int]:
    """How many live claims each control fired on since a day: a claim once per control."""

    def on_steps(where: ColumnElement[bool]) -> int:
        query = (
            select(func.count(func.distinct(steps.c.claim_id)))
            .select_from(STEPS)
            .where(where, steps.c.created_at >= since)
        )
        return int(db.execute(query).scalar_one())

    on_decisions = (
        select(func.count(func.distinct(decisions.c.claim_id)))
        .select_from(DECISIONS)
        .where(held(), decisions.c.decided_at >= since)
    )
    return {
        "hidden_instruction": on_steps(screened(False)),
        "guardrail": on_steps(screened(True)),
        "refusal": on_steps(refused()),
        "held": int(db.execute(on_decisions).scalar_one()),
        "output": on_steps(output_checked()),
        "guardian": on_steps(guarded_by_guardian()),
    }


def step_events(
    db: Connection, kind: Kind, where: ColumnElement[bool], since: str
) -> list[Detection]:
    rows = db.execute(
        select(steps.c.claim_id, steps.c.created_at, steps.c.content)
        .select_from(STEPS)
        .where(where, steps.c.created_at >= since)
        .order_by(steps.c.created_at.desc())
        .limit(MOST_EVENTS)
    )
    return [
        event(kind, claim_id, at, str(content).removeprefix(f"{FLAGGED}.").strip())
        for claim_id, at, content in rows
    ]


def detections_since(db: Connection, since: str) -> list[Detection]:
    """The latest detections on live claims since a day, newest first: each claim once per
    control, at its latest, at most MOST_EVENTS."""
    found = [
        *step_events(db, "hidden_instruction", screened(False), since),
        *step_events(db, "guardrail", screened(True), since),
        *step_events(db, "refusal", refused(), since),
        *step_events(db, "output", output_checked(), since),
        *step_events(db, "guardian", guarded_by_guardian(), since),
    ]
    rows = db.execute(
        select(
            decisions.c.claim_id,
            decisions.c.decided_at,
            decisions.c.hold_reason,
            decisions.c.payout,
            decisions.c.approval_limit,
        )
        .select_from(DECISIONS)
        .where(held(), decisions.c.decided_at >= since)
        .order_by(decisions.c.decided_at.desc())
        .limit(MOST_EVENTS)
    )
    found.extend(
        event("held", claim_id, at, reason or over_limit(float(paid), float(limit)))
        for claim_id, at, reason, paid, limit in rows
    )
    latest: dict[tuple[str, Kind], Detection] = {}
    for one in sorted(found, key=lambda d: d.at, reverse=True):
        latest.setdefault((one.claim_id, one.kind), one)
    return list(latest.values())[:MOST_EVENTS]


def false_alarms(db: Connection, guardrail: bool, since: str) -> int:
    """Claims a screening referral stopped that a person then approved: the check was wrong."""
    query = (
        select(func.count(func.distinct(steps.c.claim_id)))
        .select_from(STEPS.join(decisions, decisions.c.claim_id == steps.c.claim_id))
        .where(
            screened(guardrail),
            steps.c.created_at >= since,
            decisions.c.decision == DecisionKind.APPROVE,
        )
    )
    return int(db.execute(query).scalar_one())


def after_of(db: Connection, found: list[Detection]) -> list[Detection]:
    """What a person did after each detection, from the claim's decision."""
    ids = list({d.claim_id for d in found})
    if not ids:
        return found
    rows = db.execute(
        select(
            decisions.c.claim_id,
            decisions.c.decision,
            decisions.c.decided_by,
            decisions.c.signed_off_by,
        ).where(decisions.c.claim_id.in_(ids))
    ).all()
    made = {claim_id: (decision, by, signed) for claim_id, decision, by, signed in rows}
    out: list[Detection] = []
    for d in found:
        decision, by, signed = made.get(d.claim_id, (None, None, None))
        if d.kind == "held":
            after = f"Signed off by {signed}" if signed else "Waiting for sign-off"
        elif decision is None or by == SCREENING_MAKER:
            after = "Waiting for a handler"
        else:
            after = f"{str(decision).capitalize()}d by {by}"
        out.append(d.model_copy(update={"after": after}))
    return out


# The red-team attack that tests the output guard.
OUTPUT_ATTACK = "RT-09"


def output_tested(report: RedTeamReport | None) -> dict[str, int | None]:
    """Whether the output-guard attack held in the latest run: 1 of 1, 0 of 1, or not run."""
    found = (
        next((r for r in report.results if r.attack_id == OUTPUT_ATTACK), None) if report else None
    )
    if found is None:
        return {"stopped": None, "reached": None}
    return {"stopped": int(found.passed), "reached": 1}


def guardrails_of(
    db: Connection, since: str, counts: dict[Kind, int], report: RedTeamReport | None
) -> list[Guardrail]:
    """Every protection in the order a claim meets it, the missing one included."""
    layers = {layer.key: layer for layer in layers_of(report)}

    def tested(key: LayerKey) -> dict[str, int | None]:
        layer = layers.get(key)
        if report is None or layer is None:
            return {"stopped": None, "reached": None}
        return {"stopped": layer.stopped, "reached": layer.reached}

    none: dict[str, int | None] = {"stopped": None, "reached": None}
    return [
        Guardrail(
            key="guardrail",
            name="Bedrock guardrail",
            where="Input",
            does="Blocks harmful or injected text before anything reads it",
            mode="On AWS",
            hits=counts["guardrail"],
            false_alarms=false_alarms(db, True, since),
            **none,
        ),
        Guardrail(
            key="hidden_instruction",
            name="Hidden-instruction check",
            where="Input",
            does="A separate model reads the claim and receipts, and refers any hidden "
            "instruction unseen",
            mode="Enforcing",
            hits=counts["hidden_instruction"],
            false_alarms=false_alarms(db, False, since),
            **tested("screening"),
        ),
        Guardrail(
            key="refusal",
            name="Claim agent",
            where="Model",
            does="Its model can refuse, and its tools take the claim from the session, never "
            "from the model",
            mode="Built in",
            hits=counts["refusal"],
            false_alarms=None,
            **tested("agent"),
        ),
        Guardrail(
            key="held",
            name="Payout limit",
            where="Tool",
            does="The payout is worked out in code; one over the approval limit is held",
            mode="Enforcing",
            hits=counts["held"],
            false_alarms=None,
            **tested("limits"),
        ),
        Guardrail(
            key="guardian",
            name="Guardian",
            where="Action",
            does="Watches each approval as it happens and holds one that doesn't add up: a failed "
            "check, a flagged claim, more than was claimed, or a looping agent",
            mode="Enforcing",
            hits=counts["guardian"],
            false_alarms=None,
            stopped=None,
            reached=None,
        ),
        Guardrail(
            key="sign_off",
            name="Senior sign-off",
            where="Person",
            does="A senior handler approves every held payout",
            mode="Enforcing",
            hits=None,
            false_alarms=None,
            **tested("sign_off"),
        ),
        Guardrail(
            key="output",
            name="Output guard",
            # The attack that asks the agent to repeat a card number tests this one.
            **output_tested(report),
            where="Output",
            does="Removes card, phone and tax file numbers and email addresses from what the "
            "agent writes, before anyone reads it",
            mode="Enforcing",
            hits=counts["output"],
            false_alarms=None,
        ),
    ]


def over_limit(payout: float, limit: float) -> str:
    return f"Approved ${payout:,.2f}, over the ${limit:,.2f} approval limit"


def event(kind: Kind, claim_id: str, at: str, summary: str) -> Detection:
    return Detection(
        kind=kind,
        control=CONTROLS[kind],
        claim_id=claim_id,
        at=str(at),
        summary=summary[:300],
        outcome=OUTCOMES[kind],
    )


def report_in_use(db: Connection, version: int | None) -> RedTeamReport | None:
    """The latest red-team run against the version in use, or an untagged run from before runs
    kept their version; never a candidate's gate run."""
    tagged = redteam_reports.c.config_version
    row = (
        db.execute(
            select(redteam_reports)
            .where(or_(tagged.is_(None), tagged == version))
            .order_by(redteam_reports.c.report_id.desc())
            .limit(1)
        )
        .mappings()
        .first()
    )
    return None if row is None else RedTeamReport.model_validate(dict(row))


# --- Routes ---


@posture_router.get("/posture", operation_id="get_security_posture")
def get_posture(_: SignedInEngineer, db: Database) -> Posture:
    """Would an attack be stopped, and where: the security posture at a glance."""
    live = current_version(db)
    report = report_in_use(db, live)
    layers = layers_of(report)
    tested_version = report.config_version if report else None
    readiness = Readiness(
        payouts_paused=payout_switch(db).paused,
        live_version=live,
        tested_version=tested_version,
        live_version_red_teamed=live is not None and tested_version == live,
    )
    issues = issues_of(report, layers, readiness)
    return Posture(
        verdict=verdict_of(report, issues),
        redteam=(
            RedTeamSummary(
                run_at=report.run_at,
                run_by=report.run_by,
                config_version=report.config_version,
                attacks=len(report.results),
                held=sum(r.passed for r in report.results),
                paid=round(sum(r.paid for r in report.results), 2),
            )
            if report
            else None
        ),
        layers=layers,
        inventory=Inventory(
            agents=len(AGENTS),
            models=len({row[1] for row in AGENTS}),
            risks=len(CATALOGUE),
            live_version=live,
        ),
        controls=controls_of(report),
        issues=issues,
        detections=counts_since(db, since_of(POSTURE_DAYS)),
        detection_days=POSTURE_DAYS,
        readiness=readiness,
    )


@posture_router.get("/detections", operation_id="list_detections")
def list_detections(_: SignedInEngineer, db: Database, days: Days = 14) -> Detections:
    """Each control that fired on a live claim over the last days, today included."""
    since = since_of(days)
    counts = counts_since(db, since)
    report = report_in_use(db, current_version(db))
    return Detections(
        days=days,
        since=since,
        counts=counts,
        events=after_of(db, detections_since(db, since)),
        guardrails=guardrails_of(db, since, counts, report),
        red_teamed=report is not None,
    )
