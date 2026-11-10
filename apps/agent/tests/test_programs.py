"""Lookup programs on AgentCore Code Interpreter (plan phase 5): one session per program, always
stopped, output capped, failures readable; offered only when a sandbox is set up."""

import ast
from typing import Any

from undercover_agent.programs import (
    HELPER,
    HELPER_FILE,
    MAX_OUTPUT,
    PROGRAM_TOOL,
    CodeInterpreterRunner,
)

GATEWAY = "https://gw.example/mcp"


class FakeInterpreter:
    def __init__(self, stdout: str = "", exit_code: int = 0, fails_on: str = "") -> None:
        self.stdout, self.exit_code, self.fails_on = stdout, exit_code, fails_on
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.stopped: list[str] = []

    def start_code_interpreter_session(self, **call: Any) -> dict[str, Any]:
        if self.fails_on == "start":
            raise RuntimeError("AccessDeniedException")
        return {"sessionId": "s-1"}

    def invoke_code_interpreter(self, **call: Any) -> dict[str, Any]:
        self.calls.append((call["name"], call["arguments"]))
        if self.fails_on == call["name"]:
            raise RuntimeError("ValidationException")
        out = {"stdout": self.stdout, "stderr": "Traceback: boom", "exitCode": self.exit_code}
        return {"stream": [{"result": {"structuredContent": out, "isError": False}}]}

    def stop_code_interpreter_session(self, **call: Any) -> None:
        self.stopped.append(call["sessionId"])


def runner(fake: FakeInterpreter) -> CodeInterpreterRunner:
    return CodeInterpreterRunner("ci-1", GATEWAY, "context___", "ap-southeast-2", fake)


def test_a_program_runs_after_its_helper_and_the_session_always_ends() -> None:
    fake = FakeInterpreter(stdout="Trip Delay waits 6 hours\n")
    ran = runner(fake).run("print(get_plan('first')['plan']['name'])")
    assert (ran.text, ran.is_error) == ("Trip Delay waits 6 hours", False)
    (write, files), (execute, code) = fake.calls
    assert write == "writeFiles"
    assert files["content"][0]["path"] == HELPER_FILE
    assert GATEWAY in files["content"][0]["text"]
    assert "context___" in files["content"][0]["text"]
    assert execute == "executeCode"
    assert code["code"].startswith("from context_tools import *")
    assert fake.stopped == ["s-1"]


def test_a_failing_program_is_an_error_the_model_can_read_and_output_is_capped() -> None:
    failed = runner(FakeInterpreter(stdout="partial", exit_code=1)).run("1/0")
    assert failed.is_error
    assert "Traceback" in failed.text
    long = runner(FakeInterpreter(stdout="x" * (MAX_OUTPUT * 2))).run("print('x')")
    assert len(long.text) == MAX_OUTPUT


def test_an_unavailable_sandbox_or_a_failed_step_never_leaves_a_session_open() -> None:
    down = runner(FakeInterpreter(fails_on="start")).run("print(1)")
    assert down.is_error
    assert "directly" in down.text
    fake = FakeInterpreter(fails_on="executeCode")
    assert runner(fake).run("print(1)").is_error
    assert fake.stopped == ["s-1"]
    assert runner(FakeInterpreter()).run("x" * 5000).is_error


def test_the_helper_is_valid_python_with_every_lookup() -> None:
    source = HELPER.format(url=GATEWAY, region="ap-southeast-2", prefix="context___")
    names = {n.name for n in ast.parse(source).body if isinstance(n, ast.FunctionDef)}
    assert {
        "lookup_term",
        "get_plan",
        "get_claim_rules",
        "search_documents",
        "read_section",
    } <= names


def test_the_program_tool_takes_only_a_program() -> None:
    assert PROGRAM_TOOL["name"] == "run_lookup_program"
    assert list(PROGRAM_TOOL["input_schema"]["properties"]) == ["program"]
