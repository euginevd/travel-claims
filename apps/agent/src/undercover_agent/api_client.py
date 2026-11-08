"""The one client the agent uses to reach the api, always with the agent's key."""

from typing import Any, cast

import httpx2

from undercover_agent.models import Call

Json = dict[str, Any]
STEP_LENGTH = 20_000
FIRST_ERROR_STATUS = 400


class ApiError(Exception):
    """The api refused a request, with its reason."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


class ApiClient:
    """The api's agent routes for one claim at a time."""

    def __init__(self, base_url: str, key: str, http: httpx2.Client | None = None) -> None:
        self._http = http or httpx2.Client(base_url=base_url, timeout=30.0)
        self._key = key

    def _call(self, method: str, path: str, body: Json | None = None) -> Any:
        response = self._http.request(method, path, json=body, headers={"X-API-Key": self._key})
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
        path = f"/api/agent/claims/{claim_id}/payment"
        return cast(Json, self._call("POST", path, {"amount": amount}))

    def hold(self, claim_id: str, reason: str) -> Json:
        path = f"/api/agent/claims/{claim_id}/hold"
        return cast(Json, self._call("POST", path, {"reason": reason}))

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
