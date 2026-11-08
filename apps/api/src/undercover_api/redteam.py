"""The red-team suite as handlers see it: start a run from the dashboard, see it running, and
read the latest report. The agent runs the attacks; this keeps whether a run is going."""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import Connection, delete, insert, select

from undercover_api.agent_service import AgentRefusedError, AgentService, AgentUnavailableError
from undercover_api.auth import Database, SeniorHandler, SignedIn
from undercover_api.db import now, redteam_reports, settings
from undercover_api.models import RedTeamReport, RedTeamRun

RUNNING = "redteam_running"
# A run that hasn't reported back by then has stopped, so another may start.
STALE_AFTER = timedelta(minutes=20)

redteam_router = APIRouter(prefix="/api/staff", tags=["staff"])


class RedTeamStatus(BaseModel):
    """Whether a run is going, and the latest report."""

    running: bool
    started_at: str | None
    started_by: str | None
    report: RedTeamReport | None


def running_since(db: Connection) -> tuple[str, str] | None:
    """When and by whom the current run started, or None when none is going."""
    row = db.execute(select(settings.c.value).where(settings.c.key == RUNNING)).first()
    if row is None:
        return None
    value = row.value
    started = datetime.fromisoformat(str(value["started_at"]))
    if datetime.now(UTC) - started > STALE_AFTER:
        return None
    return str(value["started_at"]), str(value["started_by"])


def clear_running(db: Connection) -> None:
    db.execute(delete(settings).where(settings.c.key == RUNNING))


def latest_report(db: Connection) -> RedTeamReport | None:
    row = (
        db.execute(select(redteam_reports).order_by(redteam_reports.c.report_id.desc()).limit(1))
        .mappings()
        .first()
    )
    return None if row is None else RedTeamReport.model_validate(dict(row))


def status_of(db: Connection) -> RedTeamStatus:
    going = running_since(db)
    return RedTeamStatus(
        running=going is not None,
        started_at=going[0] if going else None,
        started_by=going[1] if going else None,
        report=latest_report(db),
    )


@redteam_router.get("/redteam", operation_id="get_redteam_report")
def get_redteam_report(_: SignedIn, db: Database) -> RedTeamStatus:
    """The latest red-team run, and whether one is going now."""
    return status_of(db)


@redteam_router.put("/redteam", operation_id="record_redteam_report")
def record_redteam_report(run: RedTeamRun, handler: SeniorHandler, db: Database) -> RedTeamReport:
    """Keep a red-team run's results, run by the senior handler signed in; the run is over."""
    stamp = now()
    results = [result.model_dump() for result in run.results]
    db.execute(insert(redteam_reports).values(run_at=stamp, run_by=handler.name, results=results))
    clear_running(db)
    return RedTeamReport(run_at=stamp, run_by=handler.name, results=run.results)


@redteam_router.post("/redteam/runs", operation_id="start_redteam_run", status_code=202)
def start_redteam_run(request: Request, handler: SeniorHandler, db: Database) -> RedTeamStatus:
    """Ask the agent to run the red-team suite, one run at a time."""
    going = running_since(db)
    if going is not None:
        raise HTTPException(409, "The red team is already running. Its report appears when done.")
    clear_running(db)
    db.execute(
        insert(settings).values(
            key=RUNNING,
            value={"started_at": now(), "started_by": handler.name},
            changed_by=handler.name,
            changed_at=now(),
        )
    )
    db.commit()
    service: AgentService = request.app.state.agent
    try:
        service.redteam()
    except AgentUnavailableError as error:
        clear_running(db)
        db.commit()
        code = 502 if isinstance(error, AgentRefusedError) else 503
        raise HTTPException(code, f"The red team couldn't start: {error}") from error
    return status_of(db)
