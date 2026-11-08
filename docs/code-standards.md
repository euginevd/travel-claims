# Code standards

How to write the code, numbered so reviews can cite them. `AGENTS.md` covers what to build and the workflow; these cover how.

## General

1. Keep it simple: the smallest change that meets the spec or plan, for cases that exist now. Measure before optimising.
2. Names say what; comments say why, in one line. No dead code, unused imports or compat shims.
3. Match the surrounding code, and use the framework's own way first, checked against the installed version's docs.
4. One job per module and per function. Each external service is reached through one module, the only place with its settings.
5. Write a literal once. Settings come from environment variables, validated at startup.

## Errors and logs

6. Handle an error only where you can do something useful with it; otherwise let it surface.
7. Fail closed: when a security or payment check can't complete, deny.
8. Log structured JSON with a request ID. Never log secrets or personal data; redact at the source.

## Safe by design

9. Validate every input at the boundary (API, files, queues) against a schema, and reject what doesn't match.
10. Check authorisation on every request, on the server, and deny by default.

## Tests

11. Add tests with each change, including the abuse cases in `threat-model.md`. Stub models, cloud and paid services.
12. Keep test coverage at 80% or more for new code.

## Terraform

13. One root per unit in `aws/<unit>/`, copied from `aws/api`: `main.tf`, `variables.tf`, `outputs.tf`, `versions.tf` and the lock file. Pin Terraform and providers; never commit state.
14. No hardcoded IDs, regions, ARNs, project names or environments. Name resources `${var.project}-<unit>-<what>-${var.environment}`, give every IAM role the `${var.project}-boundary` boundary, and tag through `default_tags`.

## Languages

15. Python: current stable version, `uv run` for everything, `ruff` to lint and format, `pyright` in strict mode.
16. TypeScript: strict mode, never `any`; ESLint and Prettier. Web pages meet WCAG 2.2 AA.

## AI and agents

17. The model decides; deterministic code acts. Limits, payments and permissions are enforced in code, never in a prompt.
18. Model output and uploaded content are untrusted: keep content apart from instructions, ask for structured output, and validate it against a schema.
19. Every model call uses an explicit model ID (never "latest"), a timeout, a token limit and a retry cap.
20. Prompts and model settings live in the repo; changing them is a code change, with evals in CI.
21. Instructions give the goal, the inputs and what done looks like, not the steps.

## Docs

22. Each fact lives in one place; everywhere else links to it. Keep docs short, and write what's true now; mark future work *(planned)*.
23. Root files are uppercase (`README.md`, `AGENTS.md`); everything in `docs/` and `guides/` is lowercase kebab-case.
