"""Threat coverage for the AI control plane, against four frameworks: the OWASP Top 10 for LLM
applications (2026), OWASP's Top 10 for agentic applications (2026), the OWASP MCP Top 10 (beta)
and CSA MAESTRO's seven layers. Each risk has UnderCover's control, the red-team attacks that test
it with their latest result, and a status worked out in code: tested (an attack reached it and
held), failing (one got through), built in (a build or design control, no attack), a gap, or not
applicable. Attacks are matched by their tags in today's suite, so an older run still reads."""

from dataclasses import dataclass
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import Connection, func, select

from undercover_api.auth import Database, SignedInEngineer
from undercover_api.db import decisions, steps
from undercover_api.kill_switch import payout_switch
from undercover_api.models import SCREENING_MAKER, PayoutSwitch, RedTeamResult
from undercover_api.redteam import AttackPlans, latest_report, retagged

threats_router = APIRouter(prefix="/api/engineering")

Status = Literal["tested", "failing", "built_in", "gap", "na"]
Untested = Literal["built_in", "gap", "na"]
FrameworkKey = Literal["llm", "agentic", "mcp", "maestro"]


@dataclass(frozen=True)
class Risk:
    """One risk in a framework: its id, our control, and what it is when no attack reaches it;
    its 2025 id if it moved, and the attack tags that test it (its own id unless given)."""

    id: str
    risk: str
    control: str
    untested: Untested = "gap"
    was: str = ""
    atlas: str = ""
    guardrail: str = ""
    note: str = ""
    tags: tuple[str, ...] = ()

    def matches(self) -> set[str]:
        return set(self.tags or (self.id,))


LLM_2026 = (
    Risk(
        "LLM01",
        "Prompt injection",
        "On AWS a Bedrock guardrail on the customer's text, then the hidden-instruction check on "
        "a separate model, before the agent reads a claim or receipt",
        atlas="AML.T0051",
        guardrail="screening",
    ),
    Risk(
        "LLM02",
        "Sensitive information disclosure",
        "Tools take the claim and customer from the session, never the model; an output guard "
        "removes personal data; logs redact it",
        atlas="AML.T0057",
    ),
    Risk(
        "LLM03",
        "Excessive agency",
        "The agent decides; code pays. An approval limit only a senior handler changes, one "
        "payment per claim, the guardian, the payouts switch and the Copilot's confirm cards",
        was="LLM06",
        guardrail="refusal",
    ),
    Risk(
        "LLM04",
        "Supply chain",
        "Packages pinned a week old, images by digest, Dependabot with a cooldown, an SBOM and "
        "scans on every PR",
        untested="built_in",
        was="LLM03",
        atlas="AML.T0010",
        note="Checked on every PR, not by an attack",
    ),
    Risk(
        "LLM05",
        "Data and model poisoning",
        "Memory keeps decisions, section numbers and check counts only, one namespace per "
        "customer, never the customer's words or the model's",
        was="LLM04",
        atlas="AML.T0020",
    ),
    Risk(
        "LLM06",
        "Unbounded consumption",
        "At most 20 items a claim, call limits and timeouts, the guardian's model-call rule, a "
        "daily budget that switches the agent off, spending limits on exams and improvement",
        was="LLM10",
        atlas="AML.T0034",
    ),
    Risk(
        "LLM07",
        "Misinformation",
        "Answers rest on the policy wording; on AWS a grounding guardrail and Automated "
        "Reasoning; the judge grades explanations",
        was="LLM09",
    ),
    Risk(
        "LLM08",
        "Hidden context exposure",
        "Instructions are never repeated; tools return the customer's own data only",
        was="LLM07",
    ),
    Risk(
        "LLM09",
        "Vector and embedding weaknesses",
        "The knowledge base holds the policy documents only, no customer data",
        untested="na",
        was="LLM08",
        note="Nothing private in it to leak",
    ),
    Risk(
        "LLM10",
        "Improper output handling",
        "Every model answer is checked against a schema; an output guard; plain text in the "
        "console; drafts are confirmed by the customer",
        was="LLM05",
    ),
)

AGENTIC_2026 = (
    Risk(
        "ASI01",
        "Agent goal hijack",
        "Claim content kept apart from instructions; the check refers anything that gives the "
        "AI orders; the guardian",
        atlas="AML.T0051",
        guardrail="screening",
    ),
    Risk(
        "ASI02",
        "Tool misuse",
        "Cedar policy per gateway; payouts come from the agent's own calculation; the api "
        "refuses payments over the limit; confirm cards",
        guardrail="refusal",
    ),
    Risk(
        "ASI03",
        "Identity and privilege abuse",
        "A separate issuer per audience; the agent's key never acts as a person; the Copilot "
        "acts as the handler",
    ),
    Risk(
        "ASI04",
        "Agentic supply chain",
        "No tools loaded at run time; our own MCP server, pinned and deployed by Terraform",
        untested="built_in",
        note="Checked on every PR, not by an attack",
    ),
    Risk(
        "ASI05",
        "Unexpected code execution",
        "Code execution is off by default; when on, lookup programs run in AgentCore's sandbox",
        untested="built_in",
        note="By design",
    ),
    Risk(
        "ASI06",
        "Memory and context poisoning",
        "Memory per customer, from decisions only, never from screened claims or evaluations",
    ),
    Risk(
        "ASI07",
        "Insecure inter-agent communication",
        "Specialists run in-process and only advise; the claim agent decides against the "
        "receipts; Context is IAM-only on AWS",
    ),
    Risk(
        "ASI08",
        "Cascading failures",
        "Each claim's tools reach only that claim; the agent and payouts switches; the budget; "
        "the guardian",
    ),
    Risk(
        "ASI09",
        "Human-agent trust exploitation",
        "Fake approvals in claims are data; confirm cards; the case brief shows the evidence, "
        "not just a verdict",
    ),
    Risk(
        "ASI10",
        "Rogue agents",
        "The improver is bounded; exam and red-team gates; live versus exam; rollback",
        untested="built_in",
        note="The release gates",
    ),
)

MCP_TOP_10 = (
    Risk(
        "MCP01",
        "Token mismanagement and secret exposure",
        "AgentCore Identity's vault holds the keys; no token reaches a model",
        "built_in",
    ),
    Risk(
        "MCP02", "Privilege escalation by scope creep", "A Cedar allow-list per gateway", "built_in"
    ),
    Risk(
        "MCP03",
        "Tool poisoning",
        "Our own server; tool descriptions in code, reviewed in PRs",
        "built_in",
    ),
    Risk(
        "MCP04",
        "Supply chain and dependency tampering",
        "Pinned packages, images by digest, scans on every PR",
        "built_in",
    ),
    Risk(
        "MCP05",
        "Command injection and execution",
        "No tool runs a command; lookups are read-only",
        "built_in",
    ),
    Risk(
        "MCP06",
        "Prompt injection through contextual payloads",
        "What a tool returns is data, never instructions; receipts are screened before a tool "
        "reads them",
        "built_in",
    ),
    Risk(
        "MCP07",
        "Insufficient authentication and authorisation",
        "Context is IAM-only on AWS; gateways check the caller",
        "built_in",
    ),
    Risk(
        "MCP08",
        "Lack of audit and telemetry",
        "Every tool call is a step in the trace, on the Overview's feed and in the sealed audit "
        "log",
        "built_in",
    ),
    Risk("MCP09", "Shadow MCP servers", "One server, declared in Terraform", "built_in"),
    Risk(
        "MCP10",
        "Context injection and over-sharing",
        "Context per customer; tools return the customer's own data only",
        "built_in",
    ),
)

MAESTRO = (
    Risk(
        "L1",
        "Foundation models",
        "Claude on Bedrock through Australian profiles only; guardrails on what goes in and out",
        "built_in",
        tags=("LLM01", "LLM07", "LLM08"),
    ),
    Risk(
        "L2",
        "Data operations",
        "Aurora DSQL, the knowledge base and agent memory, each scoped to the customer",
        "built_in",
        tags=("LLM02", "LLM05", "LLM09", "ASI06"),
    ),
    Risk(
        "L3",
        "Agent frameworks",
        "LangGraph on AgentCore; tools take the claim from the session",
        "built_in",
        tags=("LLM03", "ASI01", "ASI02"),
    ),
    Risk(
        "L4",
        "Deployment and infrastructure",
        "Lambda and AgentCore Runtime; IAM-only service URLs; pinned images",
        "built_in",
        tags=("LLM04", "LLM06", "ASI04", "ASI05"),
    ),
    Risk(
        "L5",
        "Evaluation and observability",
        "The exam, the judge, traces, Live and the release gates",
        "built_in",
        tags=("ASI10", "MCP08"),
    ),
    Risk(
        "L6",
        "Security and compliance",
        "Guardrails, Cedar, the guardian, the sealed audit log, CPS 234",
        "built_in",
        tags=("ASI03", "ASI08", "LLM10"),
    ),
    Risk(
        "L7",
        "Agent ecosystem",
        "The portal, the dashboard, Wattle, the Copilot and the specialists",
        "built_in",
        tags=("ASI07", "ASI09", "MCP06"),
    ),
)

# (key, name, version, its risks)
FRAMEWORKS: tuple[tuple[FrameworkKey, str, str, tuple[Risk, ...]], ...] = (
    ("llm", "OWASP LLM Top 10", "2026", LLM_2026),
    ("agentic", "OWASP Agentic Top 10", "2026", AGENTIC_2026),
    ("mcp", "OWASP MCP Top 10", "beta", MCP_TOP_10),
    ("maestro", "CSA MAESTRO", "seven layers", MAESTRO),
)
# The risks the posture counts: the two OWASP lists.
OWASP_RISKS = LLM_2026 + AGENTIC_2026

# (agent, model, tools, what it reads, the worst it could do if tricked, what stops that)
AGENTS = (
    (
        "Hidden-instruction check",
        "claude-haiku-5-5",
        "none: reads and refers",
        "the claim and its receipts",
        "Misses an attack, which then reaches the claim agent",
        "The claim agent's scoped tools, the payout code and a person's sign-off",
    ),
    (
        "Claim agent",
        "claude-sonnet-5-5",
        (
            "get_claim, get_policy, get_claim_history, calculate_payout, record_decision, "
            "find_duplicate_receipts, search_memory"
        ),
        "its own claim and customer; context (MCP): policy wording, claims manual, plans",
        "Approves a claim it shouldn't, up to the approval limit",
        "The payout is worked out in code; over the limit waits for a senior handler",
    ),
    (
        "Specialists",
        "claude-haiku-5-5",
        "check_documents, review_medical",
        "the claim's receipts",
        "Gives the claim agent bad advice",
        "The claim agent decides; the payout code checks the amounts",
    ),
    (
        "Drafting assistant",
        "claude-haiku-5-5",
        "none: drafts only",
        "the customer's words and receipts",
        "Drafts a claim that misstates what happened",
        "The customer checks and confirms the draft; their words stay the record",
    ),
    (
        "Judge",
        "claude-haiku-5-5",
        "none: grades only",
        "two explanations of one claim at a time; keeps nothing",
        "Gives a wrong grade",
        "Grades are shown, never used to decide",
    ),
    (
        "Improver",
        "claude-sonnet-5-5",
        "proposes a configuration diff",
        "evaluation-set misses, never held-out answers",
        "Proposes weaker instructions",
        "An engineer approves it; it's kept only if it scores better and the red team holds",
    ),
    (
        "Copilot",
        "claude-sonnet-5-5",
        "reads the queue and claims as the handler; signs off only after a confirmation card",
        "what the signed-in handler can see",
        "Starts a sign-off, dispatch or send-back the handler didn't mean",
        "A confirm card; it acts as the handler, within their role",
    ),
)


class Attack(BaseModel):
    attack_id: str
    name: str
    passed: bool


class RiskRow(BaseModel):
    id: str
    was: str
    risk: str
    atlas: str
    control: str
    note: str
    status: Status
    attacks: list[Attack]
    last_fired: str | None
    fired: int


class Framework(BaseModel):
    key: FrameworkKey
    name: str
    version: str
    risks: list[RiskRow]
    mapped: int
    tested: int
    failing: int
    built_in: int
    gaps: int


class AgentRow(BaseModel):
    agent: str
    model: str
    tools: str
    sources: str
    worst_case: str
    stopped_by: str


class ThreatCoverage(BaseModel):
    redteam_run_at: str | None
    frameworks: list[Framework]
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


def tags_of(result: RedTeamResult) -> set[str]:
    return {part.strip() for part in result.owasp.split(",")}


def attacks_on(risk: Risk, results: list[RedTeamResult]) -> list[Attack]:
    return [
        Attack(attack_id=r.attack_id, name=r.name, passed=r.passed)
        for r in results
        if tags_of(r) & risk.matches()
    ]


def status_of(risk: Risk, attacks: list[Attack]) -> Status:
    if not attacks:
        return risk.untested
    return "tested" if all(a.passed for a in attacks) else "failing"


def framework_of(  # noqa: PLR0913, PLR0917 - a framework's parts, then the run
    db: Connection,
    key: FrameworkKey,
    name: str,
    version: str,
    risks: tuple[Risk, ...],
    results: list[RedTeamResult],
) -> Framework:
    """One framework's risks with their status, and its coverage counted in code."""
    rows: list[RiskRow] = []
    for risk in risks:
        attacks = attacks_on(risk, results)
        fired, last = guardrail(db, risk.guardrail)
        rows.append(
            RiskRow(
                id=risk.id,
                was=risk.was,
                risk=risk.risk,
                atlas=risk.atlas,
                control=risk.control,
                note=risk.note,
                status=status_of(risk, attacks),
                attacks=attacks,
                last_fired=last,
                fired=fired,
            )
        )
    statuses = [row.status for row in rows]
    return Framework(
        key=key,
        name=name,
        version=version,
        risks=rows,
        mapped=sum(1 for row in rows if row.control.strip()),
        tested=statuses.count("tested") + statuses.count("failing"),
        failing=statuses.count("failing"),
        built_in=statuses.count("built_in"),
        gaps=statuses.count("gap"),
    )


def agent_rows() -> list[AgentRow]:
    return [
        AgentRow(agent=a, model=m, tools=t, sources=s, worst_case=w, stopped_by=b)
        for a, m, t, s, w, b in AGENTS
    ]


@threats_router.get("/threats", operation_id="get_threat_coverage")
def threat_coverage(_: SignedInEngineer, db: Database, plan: AttackPlans) -> ThreatCoverage:
    """Each framework's risks with our controls, the attacks that test them and a status; the
    agents; the payouts switch."""
    report = retagged(latest_report(db), plan)
    results = report.results if report else []
    return ThreatCoverage(
        redteam_run_at=report.run_at if report else None,
        frameworks=[
            framework_of(db, key, name, version, risks, results)
            for key, name, version, risks in FRAMEWORKS
        ],
        agents=agent_rows(),
        payouts=payout_switch(db),
    )
