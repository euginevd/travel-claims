# Plan: grounded answers and read receipts

Spec items: Ask UnderCover's answers, the claim agent's receipts. Profile: prototype.

## Design

Two AWS services, each in Sydney with its data kept in Australia, and each a reader the app swaps in on AWS and leaves out locally, as the guardrails are.

**Receipts, read by Amazon Textract `AnalyzeExpense`.** The agent reads each receipt into fields (merchant, date, total, line items, each with a confidence) before any model sees it. On AWS the screening check, the input guardrail and the claim agent get those fields as text instead of the image, so no model reads an untrusted image and the guardrail now sees what a receipt says; the documents specialist compares the fields with the claim's items. Locally, with no reader, receipts go to Claude as images, as now. A receipt Textract can't read (a multi-page PDF, a blurred photo) goes to Claude as the image, marked unread, so nothing is lost. Not Bedrock Data Automation: from Sydney it may process receipts anywhere in Asia Pacific (decision 48).

**Ask UnderCover's answers, checked by Automated Reasoning.** A policy built from the policy wording (about 7,900 characters, inside the 50,000 limit) turns its limits, waiting periods, exclusions and payment rules into formal logic. After the grounding guardrail passes an answer, a fourth guardrail with that policy checks it: `INVALID` (the answer contradicts the wording) is held back like an ungrounded one, offering a person; `VALID` shows "Checked against your policy's rules"; anything else (`SATISFIABLE`, `NO_TRANSLATIONS`, `TRANSLATION_AMBIGUOUS`, `TOO_COMPLEX`) shows the answer as now. It only reports, never blocks, and fails open to today's behaviour if it can't be asked, since the grounding check has already passed. The Terraform provider (6.72) has no Automated Reasoning resources, so `scripts/reasoning-policy.py`, run by the `guardrail` unit as `api-key-provider.py` is, builds the policy from the wording, versions it, makes the guardrail and writes its ID into the app settings; tear down deletes both.

Touches: `apps/agent` (a receipt reader, the screening and claim inputs, the asker's check), `apps/api` and `apps/portal` (the `verified` flag on an answer and its line), `infra/aws/agent` and `infra/aws/guardrail`, the script, and the docs. Leaves the payout rules, the duplicate check and the drafting assistant as they are.

## Security risks

- R-prompt injection in receipts (threat model, hidden instructions): fields replace the image on AWS, and the input guardrail now checks receipt text. Textract can return injected text as a field; it is still data in a marked block and still checked.
- An answer that contradicts the policy: `INVALID` is held back. Automated Reasoning validates only what its variables capture, so `VALID` means "consistent with the rules it knows", worded that way.
- Permissions: the agent role gains `textract:AnalyzeExpense` and `bedrock:InvokeAutomatedReasoningPolicy` on this project's policy only.

## Phases

### 1. Receipts read by Textract

- [ ] A `ReceiptReader` (Textract on AWS, none locally) gives `ReadReceipt` fields with confidences; screening and the claim agent get the fields on AWS, images locally; an unreadable receipt falls back to the image, marked
- [ ] The input guardrail checks receipt text; the agent role may call `AnalyzeExpense`
- [ ] Tests: fields replace images when a reader is set, the fallback, and an injected instruction in a read receipt still refers the claim

### 2. Answers checked by Automated Reasoning

- [ ] `reasoning-policy.py` builds, versions and attaches the policy from the wording; the `guardrail` unit runs it and tear down deletes it
- [ ] The asker holds back `INVALID`, marks `VALID`, and fails open; the api and portal carry `verified` and show its line
- [ ] Tests: each finding's outcome, failing open, and the portal's line

### 3. Docs

- [ ] Decision 48, features, costs, threat model, architecture guide; one review of the whole branch

## PR groups

1. Phases 1–3: Grounded answers and read receipts

## Ask first

Asked and agreed (2026-11-12): Amazon Textract (`AnalyzeExpense`) and Bedrock Automated Reasoning checks, about $0.01 a receipt and cents for a demo's answers. No new packages: both through boto3, already locked.
