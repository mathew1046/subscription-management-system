---
name: build-subscription-core
description: Implement and review the Brightloop self-hosted subscription lifecycle, authentication, recurring invoices, discounts, payments and reporting in Go and PostgreSQL. Use for creating, activating, pausing, renewing or closing subscriptions, detecting active/expired subscriptions, changing billing jobs or transaction boundaries, or integrating the frontend with the subscription API. Adapt the supplied in-memory design transcript to durable multi-process operation instead of copying its demo limitations.
---

# Build Subscription Core

Read root AGENTS.md and plan.md first. Use choose-backend-patterns alongside this skill. Follow the assigned branch and file ownership. Do not estimate development duration. Do not write/run tests, benchmarks or CI unless Mathew explicitly requests them; builds and type checks are permitted. Report deferred verification honestly.

## Resolve source conflicts

Treat the problem-statement PDF and latest user requirements as authoritative. Treat the second transcript as an educational example, not production architecture.

| Transcript idea | Repository decision |
| --- | --- |
| Create, cancel, renew, list active subscriptions | Preserve these domain operations with explicit authorization and state guards. |
| Dictionary keyed by user ID | Replace with persistent indexed PostgreSQL tables; a user-to-list dictionary does not make every subscription lookup or active-list scan constant time. |
| Singleton manager | Reject a global in-memory source of truth; use stateless Go handlers and an instance-local connection pool. |
| GIL/minimal storage reduces concurrency risk | Do not rely on runtime behavior for atomic multi-step writes; use PostgreSQL transactions, row locks and unique constraints across API/worker processes. |
| Active if status is active and date is before end | Also check start date, pause, closure and explicit end-boundary semantics. |
| Renew by adding days, even after cancellation | Require policy permission, valid state and a strictly later date; do not revive cancelled subscriptions. Use calendar cadence for billing, not fixed 30/365-day approximations. |
| Subscription as subclass of manager | Model a subscription as a domain record managed by services; this is composition, not an inheritance relationship. |
| Future strategy/factory/Redis/event sourcing | Defer until actual requirements justify them. Do not add infrastructure merely because the transcript mentions it. |

## Implementation procedure

1. Locate the Go endpoint/service, SQL constraints, frontend DTO/client call and relevant ownership file. Identify the authenticated actor and permitted records before any mutation.
2. State the business rule and failure cases. Prefer small domain functions and direct SQL over generic class scaffolding. Keep API calls thin and transactions explicit.
3. Validate identifiers, dates, quantities, decimal strings, state and plan policy server-side. Frontend validation improves usability; it is not enforcement.
4. Specify the concurrency boundary. Lock the subscription/invoice before state changes; take discount locks in stable order. Preserve database uniqueness for billing periods and payment request keys.
5. Commit the business write and dependent metadata together. Keep email in the transactional outbox; do not send it before the transaction commits.
6. Update shared TypeScript contracts and teammate instructions for any contract change. Preserve response envelopes and decimal-string serialization.
7. Run only the checks currently authorized. Report what compiled, what was inspected, what needs runtime configuration and what was not verified.

## Domain invariants

- Keep persisted lifecycle Draft → Quotation → Confirmed → Active → Closed. Keep pause and close reason separate. Determine effective activity using start <= today < end and not paused/closed.
- Use UTC calendar dates and half-open billing periods. Preserve the original billing anchor across short months. A scheduled activation must not bill early.
- Snapshot plan terms and line prices/taxes when creating a subscription. Snapshot customer, lines, taxes and discount values on each invoice. Do not retroactively change issued invoices.
- Treat plan price as a recurring base fee plus product lines in this implementation. Explicitly document this assumption. Do not silently add a second fee or change pricing interpretation.
- Lock a due subscription, generate one period invoice, consume a capped discount and advance its cursor atomically. Process missed periods in bounded batches, expose failures and retry later. A process crash must not leave a cursor advanced without an invoice.
- Use decimal arithmetic. Allocate subscription discounts across eligible lines with cent rounding and exact total preservation. Determine eligibility and consumption once per invoice, not once per retry.
- Record payments against a confirmed invoice; lock it, verify positive amount <= balance, and use an idempotency key with matching payload. Mark paid only when settled. Do not allow paid invoice cancellation without a defined reversal workflow.
- Keep password hashes, session hashes and reset-token hashes server-side. Use reviewed cryptographic primitives rather than inventing an algorithm. Never allow client-selected roles.
- Show billed revenue separately from cash collected. Count active subscriptions with dates and pause state. Compute balances from recorded payments, not UI state.

## Scope and operations

Run Go API and worker as separate processes sharing self-hosted PostgreSQL. Use standard SMTP with a local Mailpit inbox during development and an operator-controlled mail server for actual email. Do not introduce hosted auth, database, payment, email or analytics APIs.

Assume neither compile success nor a language choice proves scale or production readiness. Keep database connections bounded, queries indexed/paginated, timeouts finite and errors observable. Document replay/backoff and at-least-once email delivery; never claim exactly-once SMTP delivery.

Source: user-supplied Pasted text(20261031-041948).txt. The transaction, security, date and financial safeguards are deliberate corrections/refinements of that teaching demo. No original video URL was provided.
