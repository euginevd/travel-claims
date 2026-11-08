# Threat model

A worked example: `travel-claims`. Optional: delete it if the project has no users, data or secrets to protect.

## Data

1. Passports, bank details and medical records: highly sensitive. In the claims database and receipt bucket, in Australia (business 4).
2. Claim decisions and their reasons: confidential. In the claims database.
3. Policy wording and the claims manual: internal. Read by the agent.

## Trust boundaries

4. Receipts and claim text from claimants enter the agent: untrusted input.
5. The agent's decision drives the payment code: model output leading to a real action.
6. Handlers sign in through Microsoft Entra ID (business 6); claimants sign in to the web app.

## Threats and controls

7. Prompt injection in a receipt makes the agent approve a bad claim. Controls: content kept apart from instructions (code-standards 18), limits enforced in code (spec 15), injection tests in CI. Enforced at Test and Monitor.
8. One claimant sees another's claim. Controls: authorisation on every request (code-standards 10), an abuse-case test (code-standards 11). Enforced at Code and Test.
9. The agent pays more than the policy allows. Controls: the payment code checks every limit (spec 13) and fails closed (code-standards 7). Enforced at Code and Test.
10. Personal data leaks into logs. Controls: redaction at the source (code-standards 8), a test against real receipts (status 10). Enforced at Code and Test.
11. Claim data leaves Australia through model calls. Control: the Australian inference profile (spec 16). Enforced at Deploy.
12. A secret is committed. Controls: the pre-push scan, OIDC with no long-lived keys. Enforced at Code and Deploy.

## Compliance

13. Privacy Act and the Notifiable Data Breaches scheme: a privacy impact assessment before go-live; suspected breaches assessed within 30 days.
14. APRA CPS 234: controls tested yearly; APRA told within 72 hours of a material security incident.
