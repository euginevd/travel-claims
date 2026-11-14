"""The one client the agent uses to reach the api: with its machine token on AWS, with the
agent's key locally."""

from http import HTTPStatus
from typing import Any, cast

import httpx2

from undercover_agent.identity import Token
from undercover_agent.models import Call

Json = dict[str, Any]
STEP_LENGTH = 20_000
FIRST_ERROR_STATUS = 400
# The api's answers to a token it won't take: worth one retry with a fresh token.
REFUSED = {HTTPStatus.UNAUTHORIZED, HTTPStatus.FORBIDDEN}


# The api's words for a write that lost a race on DSQL and was rolled back (its main.lost_race).
LOST_RACE = "Someone else changed this at the same time"


class ApiError(Exception):
    """The api refused a request, or the agent couldn't get its token to ask, with the reason."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


class ApiClient:
    """The api's agent routes for one claim at a time."""

    def __init__(
        self,
        base_url: str,
        key: str,
        http: httpx2.Client | None = None,
        token: Token | None = None,
    ) -> None:
        self._http = http or httpx2.Client(base_url=base_url, timeout=30.0)
        self._key = key
        self._token = token

    def _headers(self, fresh: bool = False) -> dict[str, str]:
        """The machine token when there is one (AWS), and then never the key; the key otherwise.
        A token the vault can't give is an ApiError, so callers handle it as any other refusal."""
        if self._token is None:
            return {"X-API-Key": self._key}
        try:
            token = self._token(fresh)
        except Exception as error:  # botocore's errors share no base worth naming here
            raise ApiError(
                HTTPStatus.SERVICE_UNAVAILABLE, "The agent's machine token couldn't be fetched"
            ) from error
        return {"Authorization": f"Bearer {token}"}

    def _call(self, method: str, path: str, body: Json | None = None) -> Any:
        response = self._http.request(method, path, json=body, headers=self._headers())
        if response.status_code in REFUSED and self._token is not None:
            # Refused at the door, so the api did nothing: one retry with a fresh token is safe.
            response = self._http.request(method, path, json=body, headers=self._headers(True))
        if response.status_code >= FIRST_ERROR_STATUS:
            raise ApiError(response.status_code, detail_of(response))
        return response.json()

    def claim(self, claim_id: str) -> Json:
        return cast(Json, self._call("GET", f"/api/agent/claims/{claim_id}"))

    def policy(self, claim_id: str) -> Json:
        return cast(Json, self._call("GET", f"/api/agent/claims/{claim_id}/policy"))

    def history(self, claim_id: str) -> list[Json]:
        return cast(list[Json], self._call("GET", f"/api/agent/claims/{claim_id}/history"))

    def receipts(self, claim_id: str) -> list[Json]:
        """The claim's receipts, each with its media type and bytes in base64."""
        return cast(list[Json], self._call("GET", f"/api/agent/claims/{claim_id}/receipts"))

    def duplicates(self, claim_id: str) -> list[Json]:
        """For each receipt, other claims holding the same one."""
        return cast(list[Json], self._call("GET", f"/api/agent/claims/{claim_id}/duplicates"))

    def steps(self, claim_id: str) -> list[Json]:
        return cast(list[Json], self._call("GET", f"/api/agent/claims/{claim_id}/steps"))

    def calculate_payout(self, claim_id: str, request: Json) -> Json:
        return cast(Json, self._call("POST", f"/api/agent/claims/{claim_id}/payout", request))

    def record_decision(self, claim_id: str, request: Json) -> Json:
        return cast(Json, self._call("POST", f"/api/agent/claims/{claim_id}/decision", request))

    def pay(self, claim_id: str, amount: float) -> Json:
        """Pay a claim. On Aurora DSQL two payments at once can conflict on the settings both
        read; the loser was rolled back whole, and a claim is paid at most once, so one retry is
        safe."""
        path = f"/api/agent/claims/{claim_id}/payment"
        try:
            return cast(Json, self._call("POST", path, {"amount": amount}))
        except ApiError as error:
            if error.status != HTTPStatus.CONFLICT or LOST_RACE not in error.detail:
                raise
            return cast(Json, self._call("POST", path, {"amount": amount}))

    def hold(self, claim_id: str, reason: str) -> Json:
        path = f"/api/agent/claims/{claim_id}/hold"
        return cast(Json, self._call("POST", path, {"reason": reason}))

    def start(self, claim_id: str, thread_id: str) -> Json:
        path = f"/api/agent/claims/{claim_id}/start"
        return cast(Json, self._call("POST", path, {"thread_id": thread_id}))

    def heartbeat(self, claim_id: str, thread_id: str) -> None:
        """Say the agent is still working the claim on this thread."""
        path = f"/api/agent/claims/{claim_id}/heartbeat"
        self._call("POST", path, {"thread_id": thread_id})

    def stalled_claims(self) -> list[str]:
        """Claims the agent stopped working that it may still carry on by itself."""
        found = cast(list[Json], self._call("GET", "/api/agent/stalled-claims"))
        return [str(claim["claim_id"]) for claim in found]

    def recover(self, claim_id: str) -> Json:
        """Take a stalled claim to carry it on; the api refuses one already taken."""
        return cast(Json, self._call("POST", f"/api/agent/claims/{claim_id}/recover"))

    def configuration(self, claim_id: str) -> Json:
        """The configuration the claim's attempt works with: instructions, model and effort."""
        path = f"/api/agent/claims/{claim_id}/configuration"
        return cast(Json, self._call("GET", path))

    def register_configuration(self, body: Json) -> Json:
        return cast(Json, self._call("POST", "/api/agent/configuration/initial", body))

    def finish_run(self, run_id: int) -> Json:
        return cast(Json, self._call("POST", f"/api/agent/runs/{run_id}/finish"))

    def ready_claims(self) -> Json:
        """Whether the agent switch is on, how many to work at once, and the claims ready."""
        return cast(Json, self._call("GET", "/api/agent/queue/ready"))

    def finish_dispatch(self, dispatch_id: int) -> Json:
        return cast(Json, self._call("POST", f"/api/agent/dispatches/{dispatch_id}/finish"))

    def record_grades(self, run_id: int, grades: list[Json]) -> Json:
        path = f"/api/agent/runs/{run_id}/grades"
        return cast(Json, self._call("POST", path, {"grades": grades}))

    def record_verdicts(self, compare_id: int, verdicts: list[Json]) -> Json:
        path = f"/api/agent/compare/{compare_id}/verdicts"
        return cast(Json, self._call("POST", path, {"verdicts": verdicts}))

    def brief(self, round_id: int) -> Json:
        return cast(Json, self._call("GET", f"/api/agent/rounds/{round_id}/brief"))

    def propose(self, round_id: int, body: Json) -> Json:
        return cast(Json, self._call("POST", f"/api/agent/rounds/{round_id}/proposal", body))

    def improver_failed(self, round_id: int, reason: str) -> Json:
        body = {"approve": False, "reason": reason[:1000]}
        return cast(Json, self._call("POST", f"/api/agent/rounds/{round_id}/failed", body))

    def record_step(
        self,
        claim_id: str,
        thread_id: str,
        kind: str,
        content: str,
        sources: list[Json] | None = None,
    ) -> None:
        body = {
            "thread_id": thread_id,
            "kind": kind,
            "content": content[:STEP_LENGTH] or "(empty)",
            "sources": (sources or [])[:20],
        }
        self._call("POST", f"/api/agent/claims/{claim_id}/steps", body)

    def record_model_call(self, claim_id: str, thread_id: str, call: Call) -> None:
        body = {
            "thread_id": thread_id,
            "model": call.model,
            "input_tokens": call.input_tokens,
            "output_tokens": call.output_tokens,
            "cost": round(call.cost, 6),
            "latency_ms": call.latency_ms,
        }
        self._call("POST", f"/api/agent/claims/{claim_id}/model-calls", body)


def detail_of(response: httpx2.Response) -> str:
    """The api's reason for an error, joined when FastAPI gives a list."""
    try:
        detail = response.json().get("detail")
    except ValueError:
        return f"The api answered {response.status_code}"
    if isinstance(detail, list):
        items = cast(list[Json], detail)
        return "; ".join(str(item.get("msg", item)) for item in items)
    return str(detail or f"The api answered {response.status_code}")
