# Subscription Management System — Delivery Plan

Build a professional, working Brightloop subscription platform from the supplied Subscription_Management_System.pdf. Prioritize fast delivery, complete core workflows, and simple engineering.

## Ownership

Effort split is a planning estimate, not a measured workload: Mathew ~70%, Shaheem ~15%, Alfred ~15%.

| Person | Owns | Deliverable / boundary |
| --- | --- | --- |
| **Mathew — technical lead** | Scaffold, shared contracts, database/migrations, authentication and permissions, ALL backend/domain logic, recurring billing, taxes/discounts, payments, reports, integrations, final wiring, merges, deployment preparation, and testing when requested | Complete working system; owns API routes, server code, schema, shared types, dependencies/configuration, and all final integrations |
| **Shaheem — admin/staff UI** | App shell and design components; product/variant and plan forms; quotation/subscription screens; admin staff/tax/discount settings screens | Responsive UI connected through Mathew's supplied client interfaces; no billing calculations, schema changes, or backend/auth implementation |
| **Alfred — customer/finance UI** | Login/signup/reset screens, customer portal, invoice/detail/print and payment-entry screens, dashboard/filter/chart views | Responsive UI using Mathew's interfaces; no permission enforcement, payment settlement logic, or report calculations |

Shaheem owns shared visual components; Mathew owns shared interfaces. Alfred reuses the shell/components. Helpers may start with typed fixtures isolated from production; Mathew replaces fixtures during integration. Do not duplicate backend logic in either UI workstream.

## Architecture and decisions

- Proposed baseline: Next.js App Router + TypeScript, Tailwind + shadcn/ui, Supabase Postgres + Auth. One application, one database, one lockfile; pin compatible versions during scaffolding.
- Use thin route handlers, small domain services, shared validation/DTOs, and explicit state transitions. Use database transactions/functions for billing and payment writes spanning tables.
- Use a small email adapter for reset/invoice delivery; configure real email delivery through Mathew. Use browser print styles for printable invoices.
- Use Supabase Cron for a persisted due-billing job; provide a protected manual run action using the same logic. Billing must not depend on a browser being open.
- Do not add microservices, CQRS, event sourcing, generic repositories, queues, custom auth, or a payment gateway for this first delivery. The brief requires recording payments; actual automated charging is deferred.
- Working assumptions: one Brightloop business, one configurable currency, manual payment entry, no proration or refunds in this release. Customer changes take effect at the next billing boundary. Tax rules are configurable demonstration rules, not a claim of statutory compliance.

## Build order

| Stage | Mathew (main work) | Shaheem | Alfred |
| --- | --- | --- | --- |
| 1. Foundation | Scaffold; define schema, roles, DTOs and route contracts; configure auth; publish a working shell/API skeleton | Establish typography, spacing, navigation, reusable tables/forms/status badges | Implement auth and portal layouts using agreed components |
| 2. First complete flow | Product/plan/customer services; quotation templates; subscription lifecycle; first invoice; partial/full payments | Catalog, plan, quote and subscription CRUD/status screens | Invoice list/detail/print and payment-entry views; customer own-record views |
| 3. Remaining requirements | Recurrence/catch-up; pause/renew/close policy; taxes/discount limits; invoice email; staff management; aggregate reports | Staff/tax/discount settings and lifecycle controls | Dashboard, filters, charts, overdue views; portal lifecycle controls |
| 4. Integration | Wire all real APIs, scheduler and email; resolve contracts/conflicts; remove production fixtures; prepare environment/deployment | Finish responsive states and fix assigned UI defects | Finish portal/finance states and fix assigned UI defects |
| 5. When Mathew requests | Mathew leads manual acceptance, automated tests if requested, performance measurement and release decision | Fix assigned defects | Fix assigned defects |

Merge small complete slices early. Do not wait for every UI screen before integrating the first subscription → invoice → payment flow. Stages are sequencing, not a promised timeline.

## Core requirements and engineering rules

- **Accounts and roles:** unique normalized email; password length **at least 9**, uppercase, lowercase and special character; emailed password reset. Admin manages all configuration and creates staff. Staff manage customer operations, subscriptions, invoices, payments and reports, but cannot create staff or change admin rules. Customers access only their own subscriptions/invoices and permitted lifecycle actions. Enforce roles/ownership server-side and with RLS; never trust client-provided roles.
- **Catalog/plans:** product name/type/sale price/cost/notes; priced variants (including the example Odoo +560); daily/weekly/monthly/yearly cadence, minimum quantity, availability dates, and per-plan auto-close/early-close/pause/renew policies. Do not expose product costs to customers.
- **Quotes/subscriptions:** reusable quotation templates with plan/product lines and validity days; unique subscription number, customer, dates, payment terms and priced/taxed lines. Enforce Draft → Quotation → Confirmed → Active → Closed. Track pause separately so the required lifecycle remains intact; reject invalid transitions.
- **Billing:** invoices snapshot customer details, lines, prices, tax/discount values and totals. Support Draft → Confirmed → Paid, plus explicit Cancelled state; confirm/cancel/send/print actions. Confirmed invoices are immutable except settlement/status; disallow cancelling paid invoices without a future reversal workflow.
- **No duplicate/skipped periods:** unique invoice key on subscription + period start/end; transactionally lock/recheck the due subscription, create invoice and advance next-billing date together. Repeated/concurrent/manual job runs must be idempotent. Catch up missed periods in bounded batches and expose failures for retry.
- **Calendar policy:** persist billing anchor and timezone; monthly/yearly recurrence uses calendar dates with end-of-month clamping. Pause creates no invoices while paused; resume starts a new unprorated period. Reject new subscriptions outside plan availability. Record these defaults visibly where relevant.
- **Taxes/discounts:** calculate on server with decimal money, explicit rounding and nonnegative totals. Apply eligible discounts before tax; allocate subscription-wide discounts across lines before calculating their taxes. Support fixed/percentage, purchase/quantity thresholds, start/end dates, product/subscription scope and usage caps. Default to one eligible discount per invoice (largest valid saving, deterministic tie-break). Consume usage once per generated invoice inside its transaction, never on job retries; preserve the applied rule snapshot.
- **Payments:** invoice-linked method/amount/date/note, partial payments and outstanding balance; positive amounts only, reject overpayment for this scope. Use a unique request key to prevent duplicate submissions, lock the invoice on payment entry, and mark Paid only when settled.
- **Reports/performance:** active subscriptions, billed totals, collected payments, outstanding amounts and overdue invoices with date/status/customer filters. Label billed vs collected amounts distinctly; do not imply formal revenue recognition. Paginate lists, index customer/status/due dates and billing keys, aggregate in SQL, avoid N+1 queries. **Under two seconds with thousands of subscriptions is a target, not a verified result**; Mathew measures it when he requests performance work.

Minimal schema: profiles/roles, customers, products, variants, plans, quotation_templates/lines, subscriptions/lines, tax_rules, discounts/scopes/usages, invoices/lines, payments, and billing_runs. Use foreign keys, unique document numbers and appropriate constraints. Snapshot issued financial records so later catalog edits do not change history.

## Professional UI

Use a restrained SaaS workspace: consistent sidebar/header, readable tables, clear status badges, purposeful dashboard cards, responsive layouts and accessible labelled forms. Every screen needs loading, empty, error and success states. Keep destructive actions explicit. Prefer polished core workflows over elaborate animation, landing pages, or extra features.

## Collaboration and speed policy

- Mathew establishes shared contracts first; helpers work on `feat/shaheem-admin-ui` and `feat/alfred-portal-finance-ui`. Mathew uses `feat/mathew-core` and owns merges into `main`.
- Mathew defines `src/lib/contracts/` and the client interface; helpers stay in `src/features/admin-ui/`, `src/features/portal-finance-ui/`, and their assigned page files. Shaheem owns `src/components/ui/`. Coordinate shared-file changes before editing.
- **Complete development fast. Do not write or run automated tests, add test frameworks/coverage, build CI pipelines, create extra documentation/reports, or perform speculative refactors unless Mathew explicitly asks.**
- Ordinary implementation work—validation, authorization, migrations, error handling and requested UI states—is required, not optional test work. A build/type-check for immediate integration errors is allowed; avoid repetitive checks. Formal acceptance, browser test passes and load tests wait for Mathew's instruction.
- Report shipped work, changed interfaces, blockers and unverified behavior briefly. Never claim the app was tested when testing was deferred.

Source: user-supplied Subscription_Management_System.pdf. Implementation references: [Next.js route handlers](https://nextjs.org/docs/app/getting-started/route-handlers), [Supabase Auth](https://supabase.com/docs/guides/auth/password-security), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Cron](https://supabase.com/docs/guides/cron).
