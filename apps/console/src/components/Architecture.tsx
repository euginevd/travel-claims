import type { Trace } from "../api";
import { dollars } from "../format";

/** One service a claim could pass through: its name on AWS and its stand-in locally. */
interface Service {
  key: string;
  aws: string;
  local: string;
  does: string;
  used: (trace: Trace, path: Set<string>) => boolean;
}

const said = (trace: Trace) => trace.steps.map((s) => `${s.kind} ${s.content}`).join("\n");

const SERVICES: Service[] = [
  {
    key: "customer",
    aws: "Customer",
    local: "Customer",
    does: "browser, signed in",
    used: () => true,
  },
  {
    key: "portal",
    aws: "CloudFront + S3",
    local: "Portal container",
    does: "the customers' portal",
    used: () => true,
  },
  { key: "api", aws: "Lambda", local: "api container", does: "the api", used: () => true },
  {
    key: "guardrail",
    aws: "Bedrock Guardrails",
    local: "Bedrock Guardrails",
    does: "screens the claim's text first, on AWS only",
    used: (_, path) => path.has("screening"),
  },
  {
    key: "runtime",
    aws: "AgentCore Runtime",
    local: "agent container",
    does: "the claim agent",
    used: (_, path) => path.has("claim_agent"),
  },
  {
    key: "gateway",
    aws: "AgentCore Gateway",
    local: "context container",
    does: "the MCP tools: policy wording, claims manual",
    used: (_, path) => path.has("context"),
  },
  {
    key: "memory",
    aws: "AgentCore Memory",
    local: "PostgreSQL",
    does: "what it remembers about the customer",
    used: (trace) => /memory|remember/i.test(said(trace)),
  },
  {
    key: "database",
    aws: "Aurora DSQL",
    local: "PostgreSQL",
    does: "the claim, its decision and payment",
    used: () => true,
  },
  {
    key: "receipts",
    aws: "S3",
    local: "Local disk",
    does: "the receipts",
    used: (trace) => /receipt|document/i.test(said(trace)),
  },
  {
    key: "signoff",
    aws: "Step Functions",
    local: "api",
    does: "waits for a senior's sign-off",
    used: (_, path) => path.has("sign_off"),
  },
  {
    key: "logs",
    aws: "CloudWatch",
    local: "Container logs",
    does: "its trace and logs",
    used: () => true,
  },
];

/** The same claim as an AWS architecture: every service it could reach, solid where it went.
 * Worked out from its trace; locally each service names its stand-in. */
export function Architecture({
  claimId,
  trace,
  path,
  onAws,
}: {
  claimId: string;
  trace: Trace;
  path: Set<string>;
  onAws: boolean;
}) {
  const calls = trace.model_calls.length;
  return (
    <div className="arch">
      <p className="arch-group">
        {onAws ? "AWS Cloud · ap-southeast-2 (Sydney) · dev" : "This machine · Docker Compose"}
      </p>
      <ul className="arch-services" aria-label={`The services ${claimId} could reach`}>
        {SERVICES.map((service) => {
          const used = service.used(trace, path) && (onAws || service.key !== "guardrail");
          return (
            <li key={service.key} className={used ? "is-used" : "is-skipped"}>
              <b>{onAws ? service.aws : service.local}</b>
              <span>{service.does}</span>
              <span className="visually-hidden">{used ? ": used" : ": not used"}</span>
            </li>
          );
        })}
        <li className={calls > 0 ? "is-used" : "is-skipped"}>
          <b>{onAws ? "Bedrock (Australia)" : "Anthropic API"}</b>
          <span>
            {calls} model {calls === 1 ? "call" : "calls"}, {dollars(trace.total_cost)}
          </span>
        </li>
      </ul>
      <p className="hint">Solid: what {claimId} used. Faded: on its way, not used this time.</p>
    </div>
  );
}
