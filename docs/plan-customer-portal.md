# Plan: customer portal and visual upgrade (stage 1)

Covers spec 4, 9, 15, 29 and 38: customers sign in through the local stand-in, see their own policies and claims, and submit a claim with up to five receipts; the dashboard gets a logo, imagery and layout fixes.

## Design

- **Sign-in:** the stand-in issues Cognito-shaped ID tokens with `cognito:groups` set to `handlers` or `customers`, as Cognito groups will in stage 2. `POST /api/dev/sign-in` takes a `role`; seeded customers sign in with their email and the same local password as handlers. Handler routes need the `handlers` group, customer routes the `customers` group; anything else is refused.
- **Customer routes** (`/api/my/...`), each scoped to the signed-in customer: their profile, policies, claims and one claim in plain words (status, outcome and reason, receipts; never steps, calculation lines, sources or handler notes); `POST /api/my/claims` makes a waiting claim on their own active policy; `POST /api/my/claims/{id}/receipts` adds up to five JPEG, PNG or PDF receipts of 5 MB each while the claim is waiting.
- **Receipts:** stored by one module, `storage.py`, under random names on a Docker volume (a private S3 bucket in stage 2). The type comes from the file's first bytes. Handlers download them from `GET /api/claims/{id}/receipts/{rid}` as attachments with `nosniff`; the agent reads them from its own route.
- **Agent:** the hidden-instruction check and the claim agent get each receipt as a Claude image or document block, after a line saying everything that follows is customer-supplied data.
- **Web:** a landing page with two choices, "I'm a customer" and "I'm a claims handler"; the customer's "My claims", a claim view and a "Make a claim" form; receipts on the handler's claim page; an UnderCover logo mark, an illustration, and a queue that never wraps IDs, money or dates.

## Security risks

- A customer reaches another customer's claim, policy or receipt (threat model R14): every customer query filters on the signed-in customer's id; abuse-case tests.
- A handler's token used on customer routes or the other way round (R14): group checked on every route; tests both ways.
- A malicious receipt file (R15): type from magic bytes, size and count limits, random stored names, never served inline or publicly, `nosniff`.
- Instructions hidden in a receipt (R16): the check reads the receipts before the claim agent; receipts delimited as data; limits in code.

## Phases

### 1. Sign-in and customer routes
- [x] Group-checked tokens for handlers and customers, with tests both ways
- [x] Customer routes with ownership checks and abuse tests
- [x] Receipts: upload limits, sniffing, storage, handler download, agent route

### 2. Agent reads receipts
- [x] The check and the claim agent receive receipts as content blocks, with stub tests

### 3. Web
- [x] Landing page, logo, illustration and header and queue fixes
- [x] Customer pages: my claims, claim view, make a claim with receipts
- [x] Receipts on the handler's claim page; zod schemas and fixtures for every new response

### 4. Run it
- [x] All checks pass; the stack rebuilt; a customer submits a claim with a receipt and Dana sees it

## PR groups

1. Phases 1–4 in one PR.
