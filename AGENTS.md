# AGENTS.md

## Mission and precedence

Read `plan.md` before changing code. Build the Brightloop subscription system quickly with a professional UI and correct core workflows. Follow the latest explicit user instruction. Mathew owns most implementation, all integration, and testing decisions.

## Speed-first execution

- **Complete development fast. Implement the requested feature directly with the smallest maintainable change.**
- **Do not write, generate, or run automated tests unless Mathew explicitly requests them. Do not add testing frameworks, test fixtures/suites, coverage tooling, benchmark/load-test work, or testing CI by default.**
- **Do not create extra documentation, reports, CI/CD pipelines, large refactors, speculative abstractions, or unrequested features unless Mathew asks.** Keep necessary environment variable names and run instructions brief.
- A normal build/type-check needed to resolve integration/compiler errors is allowed; do not repeatedly run it without a reason. Dedicated browser/manual acceptance passes also wait for Mathew's instruction.
- If verification is deferred, say so. Do not claim production readiness, under-two-second performance, or passed tests without evidence.
- Speed does not authorize disabling authentication, input validation, authorization, database constraints, or billing correctness. These are implementation requirements.

## Work ownership

| Owner | Responsibility |
| --- | --- |
| Mathew | Scaffold/config/dependencies, schema/migrations, shared contracts, all backend/domain services and API routes, auth/RLS, billing/jobs, taxes/discounts/payments, reporting queries, email, integration, merges and requested testing |
| Shaheem | Admin/staff presentation, catalog/plan/quote/subscription/settings UI; shared visual shell and components |
| Alfred | Auth presentation, customer portal, invoice/payment/print UI, dashboard and report presentation |

Helpers must use Mathew's contracts; do not independently implement business rules or edit schemas, shared DTOs, configuration or dependencies. Coordinate shared-file needs with Mathew. Keep existing teammates' changes intact.

## Project conventions

- Use the stack in `plan.md`; one application and database. Reuse installed components and existing patterns.
- Keep routes thin and business logic in domain services. Put shared DTOs/validation in `src/lib/contracts/`.
- Prefer functions, explicit interfaces and database transactions over abstract class hierarchies. Add a pattern only when it removes a demonstrated problem; do not install all ten backend patterns.
- Helpers may use temporary typed UI examples to unblock layout work, clearly isolated from production. Never ship fake successful mutations or fabricated report totals.
- Keep UI responsive, accessible and consistent; include loading, empty, error and success states. Use invoice print CSS rather than adding a document-generation system by default.

## Non-negotiable correctness

- Enforce role and record ownership at every server entry point. Enable RLS for exposed data. Prevent clients from assigning privileged roles; only admins can add staff.
- Use managed auth; enforce unique email and the specified password/reset policy. Never commit credentials or expose privileged keys in browser code.
- Calculate all money/taxes/discounts on the server using decimal arithmetic and an explicit rounding rule. Snapshot financial records and enforce state transitions.
- Generate recurring invoices transactionally with a unique subscription-period key. Lock/recheck concurrent work; advance the billing cursor only with a successful invoice write. Catch up due periods in bounded batches.
- Atomically enforce discount usage caps and payment idempotency. Payments may be partial; never mark an invoice paid merely because a payment request was submitted.
- Keep billing date, pause/renewal and discount precedence rules aligned with `plan.md`. Do not silently invent incompatible financial semantics.
- Paginate and index data access. Treat performance promises as unverified until Mathew authorizes measurement.
- Implement real integration failures honestly. Missing email/provider configuration is a blocker to that capability, not permission to display a fake success.

## Git and delivery

- Use the role branches in `plan.md`; Mathew controls integration into `main`. Existing explicit authorization to push applies only to the requested scope.
- Keep commits focused. Do not force-push, discard another person's work, change repository settings, or run destructive database operations without explicit authorization.
- Before changing a shared contract, coordinate it and identify affected callers. Preserve compatible contracts where practical.
- End each task with a short summary: implemented behavior, changed interfaces, build/type-check results if run, deferred testing, and blockers. No unsolicited reports or lengthy documentation.
