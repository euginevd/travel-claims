"""The api's staff routes, called with the signed-in handler's own token, never a service key."""

from typing import Any, cast

import httpx2

Json = dict[str, Any]
FIRST_ERROR_STATUS = 400
NOT_FOUND = 404
# What a request that never got an answer counts as: the api is unavailable.
UNREACHABLE = 503


class ApiError(Exception):
    """The api refused a request, with its reason."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


class StaffApi:
    """The staff api as one handler: their token goes on every request."""

    def __init__(self, base_url: str, token: str, http: httpx2.Client | None = None) -> None:
        self._http = http or httpx2.Client(base_url=base_url, timeout=30.0)
        self._token = token

    def _call(self, method: str, path: str, **kwargs: Any) -> Any:
        headers = {"Authorization": f"Bearer {self._token}"}
        try:
            response = self._http.request(method, path, headers=headers, **kwargs)
        except httpx2.TransportError as error:
            # No answer, so whether a change went through is unknown: say so, never guess.
            detail = (
                f"The api didn't answer ({type(error).__name__}); check the claim's status "
                "before trying again"
            )
            raise ApiError(UNREACHABLE, detail) from error
        if response.status_code >= FIRST_ERROR_STATUS:
            raise ApiError(response.status_code, detail_of(response))
        return response.json()

    def record_turn(self, model_calls: int, cost: float) -> None:
        """Count this turn on the control plane's agents map: calls and cost, nothing said."""
        self._call(
            "POST", "/api/staff/assistant-calls", json={"model_calls": model_calls, "cost": cost}
        )

    def me(self) -> Json:
        return cast(Json, self._call("GET", "/api/staff/me"))

    def claims(self) -> list[Json]:
        return cast(list[Json], self._call("GET", "/api/staff/claims"))

    def claim(self, claim_id: str) -> Json:
        return cast(Json, self._call("GET", f"/api/staff/claims/{claim_id}"))

    def steps(self, claim_id: str) -> list[Json]:
        return cast(list[Json], self._call("GET", f"/api/staff/claims/{claim_id}/steps"))

    def customers(self, name: str) -> list[Json]:
        return cast(list[Json], self._call("GET", "/api/staff/customers", params={"name": name}))

    def scoreboard(self) -> list[Json] | None:
        """The evaluations, or None while the app has no scoreboard."""
        try:
            return cast(list[Json], self._call("GET", "/api/staff/evaluations"))
        except ApiError as error:
            if error.status == NOT_FOUND:
                return None
            raise

    def _optional(self, path: str) -> Json | None:
        """A route's answer, or None while the api doesn't have the route."""
        try:
            return cast(Json, self._call("GET", path))
        except ApiError as error:
            if error.status == NOT_FOUND:
                return None
            raise

    def latest_dispatch(self) -> Json:
        return cast(Json, self._call("GET", "/api/staff/dispatches/latest"))

    def start_dispatch(self, agents: int) -> Json:
        body = {"concurrency": agents}
        return cast(Json, self._call("POST", "/api/staff/dispatches", json=body))

    def payout_switch(self) -> Json:
        return cast(Json, self._call("GET", "/api/staff/payouts"))

    def settings(self) -> Json | None:
        return self._optional("/api/staff/settings")

    def success_criteria(self) -> Json | None:
        return self._optional("/api/staff/success-criteria")

    def send_back(self, claim_id: str, note: str) -> Json:
        path = f"/api/staff/claims/{claim_id}/send-back"
        return cast(Json, self._call("POST", path, json={"note": note}))

    def work(self, claim_id: str) -> Json:
        return cast(Json, self._call("POST", f"/api/staff/claims/{claim_id}/work"))

    def sign_off(self, claim_id: str) -> Json:
        return cast(Json, self._call("POST", f"/api/staff/claims/{claim_id}/sign-off"))


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
