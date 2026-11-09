"""Threat coverage for the AI assurance console: each OWASP risk for LLM and agentic apps that
applies to UnderCover, mapped to MITRE ATLAS where a technique matches, with the control, the
red-team attacks that test it and their latest result, and when its guardrail last fired."""

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import Connection, func, select

from undercover_api.auth import Database, SignedInEngineer
from undercover_api.db import decisions, steps
from undercover_api.kill_switch import payout_switch
from undercover_api.models import SCREENING_MAKER, PayoutSwitch
from undercover_api.redteam import latest_report

threats_router = APIRouter(prefix="/api/engineering")

# (OWASP id, risk, ATLAS technique or "", UnderCover's control, guardrail key or "")
CATALOGUE = (
    (
        "LLM01",
        "Prompt injection",
        "AML.T0051",
        "Hidden-instruction check on a separate model before the agent reads a claim or receipt",
        "screening",
    ),
    (
        "LLM02",
        "Sensitive information disclosure",
        "AML.T0057",
        (
            "Tools take the claim and customer from the session, never the model; logs redact "
            "personal data"
        ),
        "",
    ),
    (
        "LLM03",
        "Supply chain",
        "AML.T0010",
        "Pinned packages and images, Dependabot with a cooldown, an SBOM and scans on every PR",
        "",
    ),
    (
        "LLM04",
        "Data and model poisoning",
        "AML.T0020",
        (
            "Memory holds facts and decisions only, one namespace per customer, never from "
            "screened claims"
        ),
        "",
    ),
    (
        "LLM05",
        "Improper output handling",
        "",
        (
            "Every model answer is validated against a schema; drafts are checked and confirmed "
            "by the customer"
        ),
        "",
    ),
    (
        "LLM06",
        "Excessive agency",
        "",
        (
            "The agent decides; code pays. $1,000 approval limit, one payment per claim, payouts "
            "switch"
        ),
        "refusal",
    ),
    (
        "LLM10",
        "Unbounded consumption",
        "AML.T0034",
        (
            "Call limits and timeouts, rate-limited drafts, spending limits on evaluation and "
            "improvement"
        ),
        "",
    ),
    (
        "ASI01",
        "Agent goal hijack",
        "AML.T0051",
        (
            "Claim content kept apart from instructions; the check refers anything that gives the"
            " AI orders"
        ),
        "screening",
    ),
    (
        "ASI02",
        "Tool misuse",
        "",
        "Payouts come from the agent's own calculation; the api refuses payments over the limit",
        "refusal",
    ),
    (
        "ASI03",
        "Identity and privilege abuse",
        "",
        (
            "Separate issuer per audience; the agent's key never acts as a person; Copilot acts "
            "as the handler"
        ),
        "",
    ),
    (
        "ASI06",
        "Memory and context poisoning",
        "",
        "Customer memory scoped per customer and never used in evaluations",
        "",
    ),
    (
        "ASI09",
        "Human-agent trust exploitation",
        "",
        "Fake approvals in claims are treated as data; sign-off needs a real senior handler",
        "",
    ),
)

AGENTS = (
    (
        "Claim agent",
        "claude-sonnet-5-5",
        (
            "get_claim, get_policy, get_claim_history, calculate_payout, record_decision, "
            "find_duplicate_receipts, search_memory"
        ),
        "context (MCP): policy wording, claims manual, plans",
    ),
    (
        "Hidden-instruction check",
        "claude-haiku-5-5",
        "none: reads and refers",
        "none",
    ),
    (
        "Specialists",
        "claude-haiku-5-5",
        "check_documents, review_medical",
        "the claim's receipts",
    ),
    (
        "Drafting assistant",
        "claude-haiku-5-5",
        "none: drafts only",
        "the customer's words and receipts",
    ),
    (
        "Improver",
        "claude-sonnet-5-5",
        "proposes a configuration diff",
        "evaluation-set misses, never held-out answers",
    ),
    (
        "Copilot",
        "claude-sonnet-5-5",
        "reads the queue and claims as the handler; signs off only after a confirmation card",
        "the records",
    ),
)


class Attack(BaseModel):
    attack_id: str
    name: str
    passed: bool


class ThreatRow(BaseModel):
    owasp: str
    risk: str
    atlas: str
    control: str
    attacks: list[Attack]
    last_fired: str | None
    fired: int


class AgentRow(BaseModel):
    agent: str
    model: str
    tools: str
    sources: str


class ThreatCoverage(BaseModel):
    redteam_run_at: str | None
    threats: list[ThreatRow]
    agents: list[AgentRow]
    payouts: PayoutSwitch


def guardrail(db: Connection, key: str) -> tuple[int, str | None]:
    """How often a guardrail has fired, and when it last did."""
    if key == "screening":
        count, last = db.execute(
            select(func.count(), func.max(decisions.c.decided_at)).where(
                decisions.c.decided_by == SCREENING_MAKER
            )
        ).one()
        return int(count), last
    if key == "refusal":
        count, last = db.execute(
            select(func.count(), func.max(steps.c.created_at)).where(steps.c.kind == "refusal")
        ).one()
        return int(count), last
    return 0, None


@threats_router.get("/threats", operation_id="get_threat_coverage")
def threat_coverage(_: SignedInEngineer, db: Database) -> ThreatCoverage:
    """Risks, controls, tests, guardrails, the agents and the payouts switch."""
    report = latest_report(db)
    results = report.results if report else []
    rows: list[ThreatRow] = []
    for owasp, risk, atlas, control, key in CATALOGUE:
        fired, last = guardrail(db, key)
        rows.append(
            ThreatRow(
                owasp=owasp,
                risk=risk,
                atlas=atlas,
                control=control,
                attacks=[
                    Attack(attack_id=r.attack_id, name=r.name, passed=r.passed)
                    for r in results
                    if owasp in [part.strip() for part in r.owasp.split(",")]
                ],
                last_fired=last,
                fired=fired,
            )
        )
    return ThreatCoverage(
        redteam_run_at=report.run_at if report else None,
        threats=rows,
        agents=[AgentRow(agent=a, model=m, tools=t, sources=s) for a, m, t, s in AGENTS],
        payouts=payout_switch(db),
    )
