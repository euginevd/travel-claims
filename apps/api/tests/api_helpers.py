"""Helpers shared by the api's tests."""

import io
from pathlib import Path
from typing import Any, cast

from fastapi.testclient import TestClient
from PIL import Image
from pydantic import SecretStr
from sqlalchemy import update

from undercover_api.agent_service import AgentRefusedError, AgentUnavailableError, Outcome
from undercover_api.settings import Settings

DATA = Path(__file__).resolve().parents[3] / "data"
AGENT_KEY = "k" * 64
PASSWORD = "local-test-password"
DANA = "dana.whitfield@undercover.example"
MARCUS = "marcus.oyelaran@undercover.example"
MAYA = "maya.patel@example.com"  # CUS-3001, policy POL-2001, trip 10-18 June 2026
OLIVER = "oliver.grant@example.com"


def png(size: tuple[int, int] = (200, 200)) -> bytes:
    """A small but readable PNG, as a receipt photo would be."""
    out = io.BytesIO()
    Image.new("RGB", size, "white").save(out, format="PNG")
    return out.getvalue()


def make_settings(url: str, **changes: Any) -> Settings:
    values: dict[str, Any] = {
        "database_url": url,
        "environment": "local",
        "undercover_api_key": SecretStr(AGENT_KEY),
        "local_sign_in": True,
        "handler_password": SecretStr(PASSWORD),
        "seed_data_dir": DATA,
    }
    return Settings.model_validate(values | changes)


AGENT = {"X-API-Key": AGENT_KEY}


SIGN_IN = {
    "handler": "/api/staff/dev/sign-in",
    "customer": "/api/customer/dev/sign-in",
    "engineer": "/api/engineering/dev/sign-in",
}
SAM = "sam.carter@undercover.example"


def sign_in(client: TestClient, email: str, role: str = "handler") -> dict[str, str]:
    body = {"email": email, "password": PASSWORD}
    response = client.post(SIGN_IN[role], json=body)
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['id_token']}"}


def start(client: TestClient, claim_id: str, thread_id: str = "thread-1") -> None:
    response = client.post(
        f"/api/agent/claims/{claim_id}/start", json={"thread_id": thread_id}, headers=AGENT
    )
    assert response.status_code == 200, response.text


def claiming(client: TestClient, claim_id: str, amount: float) -> None:
    """Set what the claim's customer claimed, for a test whose lines come to more: a payout
    never comes to more than the amount claimed."""
    from undercover_api.db import claims  # noqa: PLC0415 - only this helper needs the table

    engine = cast(Any, client.app).state.engine
    with engine.begin() as db:
        db.execute(
            update(claims).where(claims.c.claim_id == claim_id).values(amount_claimed=amount)
        )


def line(
    description: str,
    amount: float,
    *,
    kind: str = "item",
    quantity: int = 1,
    nights: int = 0,
    hours: float = 0,
) -> dict[str, Any]:
    return {
        "description": description,
        "amount": amount,
        "quantity": quantity,
        "kind": kind,
        "nights": nights,
        "hours": hours,
    }


def payout(
    client: TestClient,
    claim_id: str,
    benefit: str,
    lines: list[dict[str, Any]],
    paid_by_others: float = 0,
) -> dict[str, Any]:
    response = client.post(
        f"/api/agent/claims/{claim_id}/payout",
        json={"benefit": benefit, "lines": lines, "paid_by_others": paid_by_others},
        headers=AGENT,
    )
    assert response.status_code == 200, response.text
    return response.json()


def decide(client: TestClient, claim_id: str, decision: str, amount: float = 0) -> Any:
    return client.post(
        f"/api/agent/claims/{claim_id}/decision",
        json={
            "decision": decision,
            "payout": amount,
            "section": "Policy wording section 10",
            "reason": "The receipts support the claim under the plan's limits.",
            "maker": "claim_agent",
        },
        headers=AGENT,
    )


class FakeAgent:
    """The agent's service as the api sees it: records what it was asked, and can be made to
    be unreachable or to refuse."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str | None]] = []
        self.failure: AgentUnavailableError | None = None
        self.drafts: list[dict[str, object]] = []
        self.letters: list[dict[str, object]] = []
        self.questions: list[dict[str, object]] = []
        self.explained: list[dict[str, object]] = []
        self.judged: list[list[dict[str, object]]] = []
        self.draft_answer: dict[str, object] = {
            "claim_type": "baggage",
            "summary": "Bag lost on the flight to Rome",
            "story": "My checked bag didn't arrive in Rome, so I bought clothes and toiletries.",
            "incident_date": "2026-06-11",
            "incident_location": "Rome, Italy",
            "items": [
                {
                    "description": "Clothes",
                    "category": "clothing",
                    "amount": 120.0,
                    "source": "Receipt 1",
                },
            ],
            "missing_questions": ["Did the airline pay you anything?"],
            "low_confidence_fields": ["incident_date"],
        }

    def work(self, claim_id: str, thread_id: str) -> None:
        self._take(("work", claim_id, None))

    def resume(self, claim_id: str, thread_id: str, outcome: Outcome) -> None:
        self._take(("resume", claim_id, str(outcome)))

    def carry_on(self, claim_id: str, thread_id: str) -> None:
        self._take(("carry_on", claim_id, thread_id))

    def dispatch(
        self, run_id: int, claim_ids: list[str], concurrency: int, kind: str = "run"
    ) -> None:
        self._take(("dispatch" if kind == "run" else kind, str(run_id), ",".join(claim_ids)))

    def watch(self, concurrency: int) -> None:
        self._take(("watch", str(concurrency), None))

    def improve(self, round_id: int) -> None:
        self._take(("improve", str(round_id), None))

    def judge(self, run_id: int, pairs: list[dict[str, object]]) -> None:
        self._take(("judge", str(run_id), None))
        self.judged.append(pairs)

    def redteam(self) -> None:
        self._take(("redteam", "", None))

    def explain(self, request: dict[str, object]) -> dict[str, object]:
        if self.failure is not None:
            raise self.failure
        self.explained.append(request)
        return {
            "answer": "Run 1 matched 5 of 5.",
            "sources": ["Run 1"],
            "suggest": "",
            "screened": False,
        }

    def ask(self, request: dict[str, object]) -> dict[str, object]:
        if self.failure is not None:
            raise self.failure
        self.questions.append(request)
        return {
            "answer": "Your plan covers delays over 6 hours.",
            "sources": ["Policy wording section 6"],
            "action": "",
            "screened": False,
        }

    def letter(self, request: dict[str, object]) -> dict[str, object]:
        if self.failure is not None:
            raise self.failure
        self.letters.append(request)
        return {"subject": "Your claim is approved", "body": "Dear Maya, we've approved it."}

    def draft(self, request: dict[str, object]) -> dict[str, object]:
        if self.failure is not None:
            raise self.failure
        self.drafts.append(request)
        return self.draft_answer

    def _take(self, call: tuple[str, str, str | None]) -> None:
        if self.failure is not None:
            raise self.failure
        self.calls.append(call)

    def unreachable(self) -> None:
        self.failure = AgentUnavailableError("The agent's service isn't answering")

    def refusing(self) -> None:
        self.failure = AgentRefusedError("The agent didn't take the work: busy")
