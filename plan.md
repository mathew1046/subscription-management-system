# Brightloop — Detailed implementation and handoff plan

## Goal and decisions

Implement the supplied Subscription_Management_System.pdf as a professional, self-hosted application. Mathew handles the majority of implementation and final integration. Do not estimate build time or promise a completion date.

**Final stack: Go backend, PostgreSQL database, TypeScript/React with Next.js frontend.** This supersedes the earlier Supabase/Node backend proposal. No hosted database, auth, payment, email or other business API is required. Local open-source packages are implementation dependencies, not hosted backend substitutes.

| Decision | Why it fits this project | Alternative deferred |
| --- | --- | --- |
| Go `net/http` service | Compiled service, explicit concurrency, bounded connection pool and a separate worker using the same domain code | A separate Python/Node backend would add no needed capability; Rust adds complexity without a measured need |
| Self-hosted PostgreSQL + pgx | SQL constraints, transactions, row locks, numeric money and indexed reporting | In-memory dictionaries lose state; Redis is unnecessary for the initial workload |
| TypeScript + React/Next.js | Shared typed API contracts for two UI contributors; same-origin `/api` proxy | No frontend business logic or direct database calls |
| App-owned auth | Argon2id password hashing, database-backed opaque sessions, reset tokens and server permissions are visible in the repository | Hosted identity and homemade cryptographic algorithms |
| PostgreSQL outbox + SMTP | Durable email intent with bounded retries; local Mailpit development inbox | Third-party email API or in-process fire-and-forget events |
| Plain CSS/component primitives initially | Immediate shared UI foundation with no design-library setup dependency | Add a UI package only if Mathew approves the actual need |

Language choice does not prove throughput. The under-two-second requirement must be measured later when Mathew requests it.

## Source interpretation

The PDF is the functional specification. The second transcript is a small Python, in-memory CLI example, not a complete billing system. Retain its create/cancel/renew/list-active operations and modularity. Correct its missing start-date check, cancelled-renewal behavior, inheritance description and incomplete concurrency protection. A runtime/GIL or singleton is not cross-process transaction protection. Apply the two skills under `.agents/skills/` to make these decisions consistently.

## Ownership and branches

| Owner | Work | Branch |
| --- | --- | --- |
| **Mathew — majority owner** | Go API, SQL/migrations, auth/roles, domain logic, recurring billing, discounts/taxes, invoices/payments/reports, worker/email, shared DTO/client contracts, infrastructure, integration, final merges and testing when requested | `feat/mathew-core` |
| **Shaheem** | Shared UI shell/primitives and complete admin/staff catalog, plan, quotation, subscription and settings workflows | `feat/shaheem-admin-ui` |
| **Alfred** | Auth presentation, customer portal, invoice/print/payment screens and finance dashboard/filter workflows | `feat/alfred-portal-finance-ui` |

Read `shaheem.md` or `alfred.md` for detailed tasks and path ownership. Each contributor works on a separate branch/clone or worktree. Mathew alone merges to main. Push the unblocking foundation to main first; create collaborator branches from that commit. Do not make teammates wait for the remaining polish or production deployment.

## Dependency-first delivery

### 1. Mathew's unblocking foundation — implemented in this delivery

- Runnable Next frontend and Go service structure, pinned dependencies and lockfiles.
- Self-hosted PostgreSQL migration, local Compose services and environment template.
- Shared TypeScript DTOs/validation hints and typed browser client with a consistent API envelope.
- Auth signup/login/logout/me/reset endpoints; admin bootstrap CLI and admin-only staff creation.
- Catalog/configuration CRUD, quotation templates, subscriptions and lifecycle transitions.
- Invoice generation worker/manual staff trigger, invoice transitions, payment recording, report queries and SMTP outbox worker.
- Base shared UI components, login/reset forms, live-data list/detail/report screens for teammates to extend.
- Both repo-local skills and explicit branch/ownership policies.

These implementation files unblock UI development. At the initial foundation handoff, migrations, Compose deployment and end-to-end runtime behavior had not been exercised and no automated tests were included. Current implementation and subsequently authorized verification are recorded below.

### Mathew core completion — 2026-10-31

- Reviewed against the supplied PDF using three isolated Mathew worktrees; integrated auth/catalog, subscription and billing/finance fixes into `feat/mathew-core`. Kept direct SQL/domain functions; no new architecture pattern or external service was justified.
- Closed the password-reset/login race, strengthened catalog/template validation and added explicit admin-only customer-account linking. Customer input accepts optional `user_id`; omission preserves an existing link and null unlinks it. Moving an account away from customer history is rejected.
- Hardened catalog snapshots, quotation validity, recurring amount limits, lifecycle guards, payment-key concurrency, exact rounding, invoice cancellation/email coordination and report aggregation. Added indexed child lookups and full-date billing anchors through numbered migrations, preserving weekly/monthly/yearly recurrence after a shortened final period is renewed.
- Subscription detail now returns server-calculated line `subtotal`, `tax_amount`, `total` and `quote_totals` before invoice-time discounts. Shared contracts expose the existing plan snapshot and the new billing anchor. Staff invoice detail and send responses expose email state (`not_queued`, `queued`, `retrying`, `failed`, `sent`); sent means SMTP acceptance, not guaranteed inbox delivery. Existing response fields are retained.
- Worker tasks have independent time budgets; billing failure cannot prevent outbox/cleanup work. SMTP follows cancellation, skips QUIT after DATA acceptance and reserves five seconds for outbox persistence within a 17-second task budget. UTC database sessions and configuration validation are enforced; health checks include database availability.
- Local PostgreSQL and Mailpit services started; migrations 001–004 applied successfully. Go compilation, TypeScript checking and the frontend production build passed; the follow-up backend changes also compiled and the API/worker containers were rebuilt and started. No tests, browser/manual acceptance passes or performance measurements ran. These checks do not establish runtime billing correctness or the two-second target.
- Review and follow-up audits fixed customer-owner replacement, billing-failure logging, logout throttling and graceful API shutdown. Subscription creation now applies the contracted 14-day payment-term default without overriding explicit zero, and subscription filters normalize UUID casing. Forward-only migration 004 repairs evidenced legacy resume anchors without changing deployed migration 003 or invoice snapshots.
- Core PR #1 is merged. Mathew authorized generated local demo credentials and Mailpit-only email for the current handoff; real SMTP and teammate UI integration are deferred, not blockers for local backend use. Acceptance/security/concurrency/performance verification still requires explicit approval. No public deployment or changes to teammates' owned files.

### 2. Teammates develop independently

Shaheem finishes editing/status workflows and shared visual design. Alfred finishes portal lifecycle controls, invoice/payment operations and report filters/visualization. Both use the existing client and DTOs. Go implements permissions and calculations; UI displays returned values and makes allowed calls.

If an API is insufficient, report the exact endpoint, requested shape and affected screen to Mathew. Do not create a competing server or invent a second DTO. Mathew makes additive contract changes and publishes them to main before dependent work continues.

### 3. Mathew integrates and completes operational work

- Merge small UI slices; keep route ownership stable and remove any temporary layout examples before handoff.
- Local PostgreSQL, migrations and the generated demo administrator are configured. Credentials stay in the ignored, owner-readable `.env.demo.local`, not source control; never expose this local setup publicly.
- Use Mailpit for the current handoff. It captures messages locally and does not deliver externally; real SMTP integration is deferred until requested.
- Review unresolved business defaults below before handling real customer money. Add changes through explicit contracts/migrations, not silent behavior changes.
- For deployment: HTTPS, private database network, restricted database runtime role, secrets management, backups/restore procedure, worker monitoring and reverse-proxy access limits are Mathew-owned follow-up work. Compose is a local development baseline, not a hardened production deployment.
- Only when Mathew asks: manual acceptance, security/concurrency checks, automated tests, realistic data/performance checks and final release approval. Do not report these as completed from compile success.

## API contract for both collaborators

`src/lib/contracts/index.ts` contains data shapes and client validation hints. `src/lib/client.ts` is the only browser API interface. Go performs authoritative validation. Amounts/rates are strings; dates are `YYYY-MM-DD`; IDs are UUID strings. Responses are `{data, request_id}` or `{error:{code,message}, request_id}`. Lists return `{items,page,page_size,has_more}`; page size defaults to 25 and is capped at 100. Same-origin cookies carry sessions; clients must not store session tokens in localStorage.

| Capability | Method/path | Client call |
| --- | --- | --- |
| Account/session | POST `/api/auth/signup`, `/login`, `/logout`; GET `/api/auth/me` | `signup`, `login`, `logout`, `me` |
| Reset | POST `/api/auth/forgot-password`, `/reset-password` | `forgotPassword`, `resetPassword` |
| Catalog/configuration | GET/POST `/api/{resource}`; PUT `/api/{resource}/{id}` | `list`, `create`, `update` |
| Staff | GET/POST `/api/staff` | `staff`, `createStaff` |
| Subscriptions | GET/POST `/api/subscriptions`; GET `/{id}` | `subscriptions`, `createSubscription`, `subscription` |
| Lifecycle | POST `/api/subscriptions/{id}/transition` | `transition` |
| Invoices | GET `/api/invoices`; GET `/{id}`; POST `/{id}/confirm`, `/cancel`, `/send` | `invoices`, `invoice`, `invoiceAction` |
| Payments | POST `/api/payments` | `recordPayment` |
| Reports | GET `/api/reports?from=&to=&customer_id=&include_payments=true&page=&page_size=` | `report` |
| Billing | POST `/api/billing/run` | `runBilling` |

Resources: `products`, `variants`, `plans`, `taxes`, `discounts`, `customers`, `quotation-templates`. Updates replace the complete editable resource payload, not a partial patch. No destructive delete endpoint is planned; archive products instead. Staff may read configuration to prepare quotes, but only admins change catalog/tax/discount/plan rules. Customers cannot call catalog/staff/report/admin endpoints; their subscription/invoice requests are scoped to their linked customer record.

## Data and transaction design

- Tables: users, sessions, password resets, rate limits, customers, products, variants, plans, taxes, discounts, quotation templates, subscriptions/lines, invoices/lines, payments, audit events, outbox and schema migrations.
- Private PostgreSQL is accessed only by Go. No Supabase/public REST database or browser SQL access. Backend request authorization is the application boundary; deployment must use private network access and a restricted runtime role.
- A subscription stores a plan-policy snapshot plus product/variant prices and tax rates. Invoice generation snapshots customer/financial values. Later configuration changes affect new agreements, not historical invoices.
- Billing locks one due subscription, computes one period, inserts invoice/lines, consumes a discount and advances the cursor in one transaction. Unique subscription/period-start keys prevent duplicate billing. Workers skip locked rows and use bounded catch-up batches; failures set `billing_error` and a delayed retry.
- Payments lock invoices, reject overpayment and compare reused request keys with the original payload. Mark Paid only at zero remaining balance; zero-total invoices become Paid on confirmation.
- Outbox email enqueue is transactional. Worker locks messages, retries with backoff up to eight attempts, and clears body content after delivery. SMTP has at-least-once semantics; a crash after acceptance can duplicate an email. Stable Message-ID helps identification, not a delivery guarantee. Exhausted rows require operator review and deliberate requeue.

## Explicit business defaults

These are implementation choices where the brief is underspecified; they are not claims about the transcript.

1. One Brightloop business and one configured currency; all billing dates use UTC. Multi-tenant hosting and multi-currency conversion are out of scope.
2. Plan price is a recurring base fee **in addition to** product/variant line prices. Set plan price to zero for line-only pricing. The base fee is tax-free in the baseline; product taxes are applied per line. Change this interpretation explicitly if the business needs inclusive plan pricing/base-fee tax.
3. Billing periods are `[start,end)`. Monthly/yearly recurrence clamps to month end while retaining the anchor. The final shortened period is billed in full; no proration/refunds in the baseline.
4. Persist Draft → Quotation → Confirmed → Active → Closed; pause is a separate flag. Future start dates never bill early. Active-for-reporting requires `start <= today < end`, not paused. Expired, non-auto-close agreements remain persisted Active but are not counted as currently active.
5. Pause/early close requires due invoices already processed. Resume preserves prepaid coverage, or starts a new period at resume when the old period has ended. Renew only nonexpired Active agreements with permission and a strictly later end date; never revive cancelled agreements. Paused agreements may be extended without resuming.
6. One eligible discount per invoice: largest saving, UUID ordering for ties. Minimum purchase/quantity refer to the subscription invoice before discount; a product scope limits which lines receive savings. Eligibility is evaluated at period start, even during catch-up. Caps are consumed on invoice generation; cancelled invoices do not restore usage automatically.
7. Apply discounts before tax and distribute cent rounding across eligible lines. Product tax values are configurable demo rules, not statutory tax advice.
8. Billing generates draft invoices for staff confirmation. Payment terms run from invoice issue date. Record positive manual payments; no external card charging, refunds or payment reversal workflow.
9. Invoice send queues one email per invoice. Queue success is not delivery success. Staff can inspect delivery state in invoice detail. Customers without a linked account need to sign up/be linked before portal use; no anonymous invoice links.
10. Billed/collected report values use the date range; outstanding/overdue and active-subscription counts are current snapshots. Do not label these as recognized accounting revenue or MRR.

## Local setup and development

Install Docker Compose and Node 24+. For native backend development, use Go 1.27.3 (the module requires at least Go 1.26). Copy `.env.example` to `.env` for local values. Defaults are local-only.

```sh
docker compose up --build -d
# In another terminal: use your own chosen local credentials, not committed values.
docker compose run --rm -e ADMIN_EMAIL -e ADMIN_PASSWORD api create-admin
```

Set `ADMIN_EMAIL`/`ADMIN_PASSWORD` in that terminal before running the bootstrap command. Existing accounts are not overwritten. Open `http://localhost:3000`; inspect local reset/invoice messages at `http://localhost:8025`. Only localhost ports are published. Never expose these development defaults publicly.

For fast frontend iteration, run only the supporting services and use the frontend dev server:

```sh
docker compose up --build -d postgres mailpit migrate api worker
npm ci
npm run dev
```

For a native Go service, export the variables from `.env.example` with real local values; Go does not automatically load `.env`. From `backend/`: `go run ./cmd/server migrate`, `go run ./cmd/server create-admin`, `go run ./cmd/server serve`, and in a separate terminal `go run ./cmd/server worker`. The frontend proxies `/api` to `BACKEND_URL`.

Compose uses `COMPOSE_SMTP_HOST`/`COMPOSE_SMTP_PORT` (default `mailpit:1025`), while native Go uses `SMTP_HOST`/`SMTP_PORT` (default example `127.0.0.1:1025`). Both use `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` and `SMTP_FROM`. Mailpit is local capture only; use an operator-controlled TLS SMTP server for real delivery.

### Current local demo handoff — 2026-10-31

- Generated administrator, staff and customer credentials are in `.env.demo.local` (ignored by Git, mode 0600). Use the corresponding `DEMO_ADMIN_*`, `DEMO_STAFF_*` or `DEMO_CUSTOMER_*` values at `/login`. Never commit these credentials or expose this local deployment publicly.
- Mail delivery is configured to the local `mailpit:1025` service with TLS disabled for that internal development connection. Inspect captured mail at `http://localhost:8025`; no Gmail or external delivery is configured.
- Ran `node --env-file=.env.demo.local scripts/seed-demo.mjs` successfully. It uses authenticated API calls, not direct database writes or duplicated billing calculations. No new architecture pattern was needed. The local billing batch processed four periods with zero reported failures.
- Created clearly marked DEMO records: two customers, two products, one variant, one illustrative tax, two plans, one product-scoped discount, one quotation template and seven subscriptions. Samples cover Draft, Quotation, Confirmed, Active and Paused, with four invoices (one Paid, one partially paid Confirmed, two Draft), two manual sample payments and two invoice email queue requests. No real money moved.
- IDs, scenario labels and payment request keys are in the ignored, mode-0600 `.env.demo.data.json`. The seeder can reuse these local records without resetting edited lifecycle states; inspect errors before deliberate reruns. Its billing trigger processes all due subscriptions in this local database, so never point this setup at real business data. Do not delete the manifest just to reset a scenario.
- Node syntax and whitespace checks passed. Creating the demo records exercised their normal API operations, but no separate automated tests, browser/manual acceptance pass, security/concurrency checks or performance measurements were run. No teammate-owned UI files changed; editing controls remain their separate deliverables, not a blocker for backend use.

Manual walkthrough:

1. Sign in as the generated admin at `http://localhost:3000/login`. Browse `/admin/products`, `/admin/plans`, `/admin/customers` and `/admin/subscriptions` for DEMO records; `/finance` shows the resulting persisted sample balances and invoice links.
2. Open an invoice from `/portal/invoices`, inspect its lines/taxes/discount/balance, and use the existing Print invoice button. Sample totals are demo data, not actual revenue.
3. In a private browser window, sign in as the generated customer. `/portal/subscriptions` and `/portal/invoices` should show only that customer's linked records, not the Research Studio customer's data. Direct access to finance/admin data should be denied.
4. Inspect the captured invoice messages in Mailpit. For password reset, sign up a separate throwaway `.test` account, request a reset at `/forgot-password`, and follow its captured Mailpit link. Using a separate account keeps the saved demo credentials usable for reseeding.
5. Admin editing, lifecycle actions, invoice confirmation and payment entry still use the existing `/api` endpoints until teammate UI controls are ready. GET requests are read-only; use the IDs in the manifest for deliberate mutations and retain each payment's original request key on retries.

### PDF completion review — 2026-10-31

- Mathew explicitly authorized remaining PDF functionality, tests, CodeRabbit review and merge. Two isolated audits found the existing auth/catalog/subscription/billing backend covers the assigned PDF rules; added the missing optional payment ledger and an explicit outstanding-invoice filter without changing default response shapes or introducing new architecture patterns.
- `GET /api/reports?include_payments=true` adds `payments: Page<ReportPayment>`. Existing payment-date `from`/`to`, customer and currency filters apply to the ledger; summary and ledger use one read-only repeatable-read snapshot. Paging defaults to 25 and is capped at 100. Shared contracts expose `include_payments` and the optional page with invoice/customer context.
- `GET /api/invoices?status=Outstanding` selects confirmed invoices with a positive remaining balance. `status=Overdue` additionally requires the due date to precede today. Both preserve customer ownership checks and existing date/customer/pagination filters.
- Added focused Go tests for password/email/origin/strict-body validation, catalog/plan/template rules, exact money/discount allocation, calendar anchors, payment replay matching and report filters. The opt-in PostgreSQL HTTP workflow applies migrations to a fresh disposable `brightloop_test_*` database, never the running demo database. Set `TEST_DATABASE_URL` for that database before `go test -race ./... -count=1`; without it, only the database workflow skips. The test refuses an already initialized database; recreate only your disposable database between runs.
- Verified the real PostgreSQL workflow with role/ownership checks, variant +560 pricing, snapshotted prices, lifecycle guards and customer transitions, concurrent billing and a capped discount, invoice confirmation/send deduplication, overpayment rejection, replay-safe partial/full payments, overdue/outstanding views, filtered payment pagination, report reconciliation and one-use password reset with session revocation. The temporary database was removed after each run; demo records were untouched.
- `go test -race ./...` (including the opt-in database workflow), `go build ./...`, `npm run typecheck` and `npm run build` passed. Three local API read samples with 1,001 subscriptions took approximately 2–40 ms under the race detector. This is not a sustained load test or proof that every frontend page meets the PDF's two-second target; invoice samples had one invoice.
- Remaining whole-product gaps belong to teammate UI workflows: admin editing/template application/lifecycle controls and portal/finance mutation/filter controls. Browser invoice printing already exists. These are not newly claimed complete, and this review does not authorize taking over their files. Mailpit remains the requested local email transport; no public deployment or real payment processing is configured.

## Authorized verification

Allowed by default: `go build ./...` from backend, `npm run typecheck`, `npm run build`, code/contract inspection and skill-format validation. Mathew additionally authorized tests for the PDF completion review above; focused unit/race/PostgreSQL workflow checks were run. That does not create blanket permission for future tests, CI, browser passes, benchmarks or load tests. Maintain a clear distinction between implemented, compiled and runtime-verified.

References: supplied PDF and transcripts; [Go concurrency](https://go.dev/doc/effective_go#concurrency), [pgx pool](https://pkg.go.dev/github.com/jackc/pgx/v5/pgxpool), [Argon2id](https://pkg.go.dev/golang.org/x/crypto/argon2), [PostgreSQL locks](https://www.postgresql.org/docs/current/explicit-locking.html).
