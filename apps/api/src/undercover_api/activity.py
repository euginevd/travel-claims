"""The agent team at work, for the control plane's Overview: each AI agent as a persona with what
it did in the last 14 days, and a feed of what the agents are doing now.

The feed says who did what to which claim and when, and nothing more: a tool's name but never
its arguments or result, and never a claim's story. AI engineers see how the agents work, not the
customers' data (threat model: engineers see no claim text). Steps come from live claims only;
the assistants' answers carry no customer, so a red-team question to Wattle shows as an answer."""

from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import ColumnElement, Connection, Select, func, select

from undercover_api.assurance import version_in_use
from undercover_api.auth import Database, SignedInEngineer
from undercover_api.db import (
    assistant_calls,
    claims,
    decisions,
    grades,
    model_calls,
    rounds,
    steps,
)
from undercover_api.evaluations import EVALUATION
from undercover_api.redteam import REDTEAM_CUSTOMER

activity_router = APIRouter(prefix="/api/engineering")

# The claim agent's calls to the context server: reading the policy, the manual and the plans.
CONTEXT_TOOLS = {
    "search_documents",
    "read_section",
    "get_plan",
    "get_claim_rules",
    "lookup_term",
    "describe_fields",
    "search_reference_data",
}
# Every tool the claim agent has: any other name in a step is shown as "other", never as written.
KNOWN_TOOLS = CONTEXT_TOOLS | {
    "get_claim",
    "get_policy",
    "get_claim_history",
    "calculate_payout",
    "record_decision",
    "find_duplicate_receipts",
    "search_memory",
    "check_documents",
    "review_medical",
}
FEED_LENGTH = 30
# The team's figures cover the same days as the Overview's other figures.
DAYS = 14
# Steps read to fill the feed: more than it shows, since some are the red team's or an exam's.
STEPS_READ = 200
# The assistants' answers in the feed, at most, so the claims' work stays in view.
ANSWERS_SHOWN = 5
# An agent counts as working when it did something this recently.
WORKING_SECONDS = 90
FLAGGED = "Instructions found"

Target = Literal[
    "claim_agent",
    "screening",
    "documents",
    "medical",
    "wattle",
    "drafting",
    "copilot",
    "judge",
    "improver",
    "context",
    "api",
]
Kind = Literal["tool", "read", "ask", "clear", "flag", "held", "error", "answer"]
AgentKey = Literal[
    "claim_agent",
    "screening",
    "documents",
    "medical",
    "wattle",
    "drafting",
    "copilot",
    "judge",
    "improver",
]


class Persona(BaseModel):
    """One AI agent, as the Overview shows it."""

    key: AgentKey
    name: str
    model: str | None
    voice: str
    working: bool
    work: str
    cost: float | None
    last: str
    last_at: str | None


class Event(BaseModel):
    """One thing an agent did: who, to whom or what, which claim, when. No claim text."""

    event_id: str
    at: str
    agent: AgentKey | Literal["guardian"]
    to: Target | None
    kind: Kind
    tool: str
    claim_id: str | None


class Activity(BaseModel):
    team: list[Persona]
    events: list[Event]


def tool_of(content: str) -> str:
    """A tool call's name, the first word of its step, if it's one of the agent's tools: never
    its arguments, and never words of the agent's own."""
    name = content.split(None, 1)[0] if content.strip() else ""
    return name if name in KNOWN_TOOLS else "other"


def event_of(row: dict[str, Any]) -> Event | None:
    """A claim step as a feed event, or None for a step the feed doesn't show."""
    step, content = str(row["kind"]), str(row["content"] or "")
    agent: AgentKey | Literal["guardian"] = "claim_agent"
    to: Target | None = None
    tool = ""
    kind: Kind
    if step == "tool_call":
        tool = tool_of(content)
        if tool == "check_documents":
            kind, to = "ask", "documents"
        elif tool == "review_medical":
            kind, to = "ask", "medical"
        elif tool in CONTEXT_TOOLS:
            kind, to = "read", "context"
        else:
            kind, to = "tool", "api"
    elif step == "screening":
        agent, kind = "screening", "flag" if content.startswith(FLAGGED) else "clear"
    elif step == "guardian":
        agent, kind = "guardian", "held"
    elif step == "error":
        kind = "error"
    else:
        return None
    return Event(
        event_id=f"s{row['step_id']}",
        at=str(row["created_at"]),
        agent=agent,
        to=to,
        kind=kind,
        tool=tool,
        claim_id=str(row["claim_id"]),
    )


def recent_events(db: Connection, live_ids: Select[Any]) -> list[Event]:
    """The newest things the agents did on live claims, and the assistants' answers."""
    rows = (
        db.execute(
            select(
                steps.c.step_id, steps.c.claim_id, steps.c.kind, steps.c.content, steps.c.created_at
            )
            .where(
                steps.c.claim_id.in_(live_ids),
                steps.c.kind.in_(["tool_call", "screening", "guardian", "error"]),
            )
            .order_by(steps.c.step_id.desc())
            .limit(STEPS_READ)
        )
        .mappings()
        .all()
    )
    events = [e for e in (event_of(dict(r)) for r in rows) if e is not None]
    answers = db.execute(
        select(assistant_calls.c.call_id, assistant_calls.c.agent, assistant_calls.c.created_at)
        .where(assistant_calls.c.agent.in_(["wattle", "copilot"]))
        .order_by(assistant_calls.c.call_id.desc())
        .limit(ANSWERS_SHOWN)
    ).all()
    events += [
        Event(
            event_id=f"a{call_id}",
            at=str(at),
            agent="wattle" if agent == "wattle" else "copilot",
            to=None,
            kind="answer",
            tool="",
            claim_id=None,
        )
        for call_id, agent, at in answers
    ]
    events.sort(key=lambda e: e.at, reverse=True)
    return events[:FEED_LENGTH]


def latest_step(db: Connection, live_ids: Select[Any], *where: ColumnElement[bool]) -> Event | None:
    """An agent's newest step on a live claim, as a feed event: what it did last."""
    row = (
        db.execute(
            select(
                steps.c.step_id, steps.c.claim_id, steps.c.kind, steps.c.content, steps.c.created_at
            )
            .where(steps.c.claim_id.in_(live_ids), *where)
            .order_by(steps.c.step_id.desc())
            .limit(1)
        )
        .mappings()
        .first()
    )
    return event_of(dict(row)) if row else None


def counted(count: int, one: str, many: str) -> str:
    return f"{count} {one if count == 1 else many}"


def words(event: Event | None) -> str:
    """The last thing an agent did, in a few words."""
    if event is None:
        return "nothing in 14 days"
    claim = f" on {event.claim_id}" if event.claim_id else ""
    return {
        "tool": f"called {event.tool}{claim}",
        "read": f"read the policy{claim}",
        "ask": f"asked the {event.to} specialist{claim}",
        "clear": f"cleared{claim}",
        "flag": f"flagged{claim}",
        "held": f"held a payout{claim}",
        "error": f"stopped{claim}",
        "answer": "answered a question",
    }[event.kind]


def is_recent(at: str | None, now: datetime) -> bool:
    if not at:
        return False
    try:
        when = datetime.fromisoformat(at)
    except ValueError:
        return False
    return (now - when).total_seconds() <= WORKING_SECONDS


@activity_router.get("/activity", operation_id="get_agent_activity")
def get_activity(
    _: SignedInEngineer,
    db: Database,
    team: Annotated[bool, Query(description="Include the team's figures (slower)")] = True,
) -> Activity:
    """What the agents are doing now and, unless left out, the agent team over the last 14
    days. The page polls the feed often and the team rarely: the team's figures count 14 days."""
    live = (claims.c.source != EVALUATION) & (claims.c.customer_id != REDTEAM_CUSTOMER)
    live_ids = select(claims.c.claim_id).where(live)
    events = recent_events(db, live_ids)
    return Activity(team=team_of(db, live, live_ids) if team else [], events=events)


def team_of(  # noqa: PLR0914 - one figure each
    db: Connection, live: ColumnElement[bool], live_ids: Select[Any]
) -> list[Persona]:
    """The nine AI agents, each with its work and cost over the last 14 days."""
    now = datetime.now(UTC)
    since = (now - timedelta(days=DAYS)).isoformat(timespec="seconds")

    def scalar(query: Select[Any]) -> float:
        return float(cast(float | None, db.scalar(query)) or 0)

    def steps_since(*where: ColumnElement[bool]) -> int:
        query = select(func.count(steps.c.step_id)).where(
            steps.c.created_at >= since, steps.c.claim_id.in_(live_ids), *where
        )
        return int(scalar(query))

    decided = int(
        scalar(
            select(func.count(decisions.c.claim_id)).where(
                decisions.c.decided_at >= since, decisions.c.claim_id.in_(live_ids)
            )
        )
    )
    calls, cost = db.execute(
        select(func.count(model_calls.c.call_id), func.sum(model_calls.c.cost)).where(
            model_calls.c.created_at >= since, model_calls.c.claim_id.in_(live_ids)
        )
    ).one()
    in_progress = int(
        scalar(select(func.count(claims.c.claim_id)).where(live, claims.c.status == "in_progress"))
    )
    screened = steps_since(steps.c.kind == "screening")
    flagged = steps_since(steps.c.kind == "screening", steps.c.content.like(f"{FLAGGED}%"))
    documents = steps_since(steps.c.kind == "tool_call", steps.c.content.like("check_documents%"))
    medical = steps_since(steps.c.kind == "tool_call", steps.c.content.like("review_medical%"))

    def assistant(agent: str) -> tuple[int, float, str | None]:
        count, spent, last = db.execute(
            select(
                func.count(assistant_calls.c.call_id),
                func.sum(assistant_calls.c.cost),
                func.max(assistant_calls.c.created_at),
            ).where(assistant_calls.c.agent == agent, assistant_calls.c.created_at >= since)
        ).one()
        return int(count), float(spent or 0), (str(last) if last else None)

    wattle, copilot = assistant("wattle"), assistant("copilot")
    made = int(
        scalar(
            select(func.count(claims.c.claim_id)).where(
                live, claims.c.source == "customer", claims.c.ready_at >= since
            )
        )
    )
    graded, last_graded = db.execute(
        select(func.count(grades.c.claim_id), func.max(grades.c.graded_at)).where(
            grades.c.graded_at >= since
        )
    ).one()
    proposed, last_round = db.execute(
        select(func.count(rounds.c.round_id), func.max(rounds.c.started_at)).where(
            rounds.c.started_at >= since
        )
    ).one()
    version = version_in_use(db)
    agent_last = latest_step(db, live_ids, steps.c.kind == "tool_call")
    screen_last = latest_step(db, live_ids, steps.c.kind == "screening")
    docs_last = latest_step(
        db, live_ids, steps.c.kind == "tool_call", steps.c.content.like("check_documents%")
    )
    medical_last = latest_step(
        db, live_ids, steps.c.kind == "tool_call", steps.c.content.like("review_medical%")
    )
    team = [
        Persona(
            key="claim_agent",
            name="Claim agent",
            model=version.model,
            voice="Orchestrator with tools and HITL",
            working=in_progress > 0 and is_recent(agent_last.at if agent_last else None, now),
            work=f"{decided} decided · {int(calls)} model calls",
            cost=float(cost or 0),
            last=words(agent_last),
            last_at=agent_last.at if agent_last else None,
        ),
        Persona(
            key="screening",
            name="Instruction check",
            model="claude-haiku-5-5",
            voice="Prompt-injection screen",
            working=is_recent(screen_last.at if screen_last else None, now),
            work=f"{screened} read · {flagged} flagged",
            cost=None,
            last=words(screen_last),
            last_at=screen_last.at if screen_last else None,
        ),
        Persona(
            key="documents",
            name="Documents",
            model="claude-haiku-5-5",
            voice="Vision: receipts and reports",
            working=is_recent(docs_last.at if docs_last else None, now),
            work=f"{documents} asked",
            cost=None,
            last=words(docs_last).replace("asked the documents specialist", "checked documents"),
            last_at=docs_last.at if docs_last else None,
        ),
        Persona(
            key="medical",
            name="Medical",
            model="claude-haiku-5-5",
            voice="Medical evidence sub-agent",
            working=is_recent(medical_last.at if medical_last else None, now),
            work=f"{medical} asked",
            cost=None,
            last=words(medical_last).replace("asked the medical specialist", "reviewed evidence"),
            last_at=medical_last.at if medical_last else None,
        ),
        Persona(
            key="wattle",
            name="Wattle",
            model="claude-haiku-5-5",
            voice="Customer chat, policy-grounded",
            working=is_recent(wattle[2], now),
            work=counted(wattle[0], "answer", "answers"),
            cost=wattle[1],
            last="answered a customer" if wattle[2] else "nothing in 14 days",
            last_at=wattle[2],
        ),
        Persona(
            key="drafting",
            name="Drafting",
            model="claude-haiku-5-5",
            voice="Extracts a claim from chat",
            working=False,
            work=counted(made, "claim made", "claims made"),
            cost=None,
            last="drafted a claim" if made else "nothing in 14 days",
            last_at=None,
        ),
        Persona(
            key="copilot",
            name="Copilot",
            model="claude-sonnet-5-5",
            voice="Tools behind a confirm card",
            working=is_recent(copilot[2], now),
            work=counted(copilot[0], "turn", "turns"),
            cost=copilot[1],
            last="answered a handler" if copilot[2] else "nothing in 14 days",
            last_at=copilot[2],
        ),
        Persona(
            key="judge",
            name="Judge",
            model="claude-haiku-5-5",
            voice="LLM-as-judge for evals",
            working=is_recent(str(last_graded) if last_graded else None, now),
            work=f"{int(graded)} graded",
            cost=None,
            last="graded an exam" if graded else "nothing in 14 days",
            last_at=str(last_graded) if last_graded else None,
        ),
        Persona(
            key="improver",
            name="Improver",
            model="claude-sonnet-5-5",
            voice="Prompt optimiser, eval-gated",
            working=is_recent(str(last_round) if last_round else None, now),
            work=counted(int(proposed), "proposal", "proposals"),
            cost=None,
            last="proposed a version" if proposed else "nothing in 14 days",
            last_at=str(last_round) if last_round else None,
        ),
    ]
    return team
