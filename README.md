# Brightloop

A self-hosted subscription management platform for administrators, staff and customers. Manage recurring agreements, generate invoices, record manual payments and inspect financial reports from one responsive workspace.

Brightloop runs locally with **Next.js/React, Go and PostgreSQL**. Authentication, billing and email processing are self-hosted; no hosted database, auth or payment service is required.

## What it does

- **Authentication:** customer signup, opaque-cookie sessions, password reset and admin/staff/customer roles. Only administrators create staff accounts.
- **Catalog:** products, price-delta variants, recurring plans, taxes, capped discounts, customers and quotation templates.
- **Subscriptions:** Draft → Quotation → Confirmed → Active → Closed, with policy-controlled pause, resume, renewal and closure. Saved terms preserve the agreed prices and policies.
- **Invoices:** recurring generation, snapshotted line items, tax/discount amounts, confirmation, unpaid cancellation, printing and email queue status.
- **Payments:** manual cash, bank transfer, card, UPI or other receipts; partial/full settlement and replay-safe request keys. Recording a card receipt does **not** charge a card.
- **Finance:** date/customer filters, a paginated payment ledger and an explicit distinction between period activity and current outstanding/overdue balances.
- **UI:** responsive Paper & ink styling, role-aware navigation, keyboard-accessible dialogs, paginated selectors and recoverable loading/error states.

## Quick start: Docker

### Requirements

- Git and a running Docker Engine with Docker Compose.
- Free local ports: **3000, 8080, 5432, 1025 and 8025**.
- Node and Go are not needed on the host for the full Docker setup.

```bash
git clone https://github.com/mathew1046/subscription-management-system.git
cd subscription-management-system
cp .env.example .env
docker compose up --build -d
```

The default configuration is for **local development only**. If you change the PostgreSQL password before first startup, update both `POSTGRES_PASSWORD` and the native `DATABASE_URL` in `.env` consistently. Changing the environment later does not change a password already stored in the database volume.

| Service | Local address |
| --- | --- |
| Application | http://localhost:3000 |
| API health | http://localhost:8080/api/health |
| Mailpit inbox | http://localhost:8025 |
| PostgreSQL | `127.0.0.1:5432` |
| Local SMTP capture | `127.0.0.1:1025` |

Compose starts PostgreSQL, applies numbered migrations, then runs the API, background worker and web app. PostgreSQL data lives in the `pgdata` volume. Normal `docker compose down` preserves it; removing that volume destroys the saved data.

### Create the first administrator

There is no committed default administrator password. In Bash, enter your own credentials without putting the password in shell history:

```bash
read -r -p "Administrator email: " ADMIN_EMAIL
read -r -s -p "Administrator password: " ADMIN_PASSWORD
echo
export ADMIN_EMAIL ADMIN_PASSWORD
docker compose run --rm --no-deps -e ADMIN_EMAIL -e ADMIN_PASSWORD api create-admin
unset ADMIN_EMAIL ADMIN_PASSWORD
```

Passwords need at least **9 characters**, uppercase and lowercase letters, a non-space special character, and no more than **128 UTF-8 bytes**. Bootstrap does not overwrite an existing account.

Sign in at http://localhost:3000/login. Create staff from `/admin/staff`; customers can sign up at `/signup` and then sign in separately. Signup never accepts a privileged role.

## Optional local demo data

Use demo data only in a disposable/local database. The seeder invokes the normal authenticated API, including a **global due-billing batch**; it is not safe to run against real business records.

1. Install Node 24+.
2. Bootstrap an administrator using a `.test` or `.local` email address.
3. Create the ignored file `.env.demo.local`, restrict its permissions, and fill in these values. The admin pair must match the existing administrator; choose separate strong passwords for the staff and customer samples.

```dotenv
DEMO_ADMIN_EMAIL=demo.admin@brightloop.test
DEMO_ADMIN_PASSWORD=
DEMO_STAFF_EMAIL=demo.staff@brightloop.test
DEMO_STAFF_PASSWORD=
DEMO_CUSTOMER_EMAIL=demo.customer@brightloop.test
DEMO_CUSTOMER_PASSWORD=
```

```bash
chmod 600 .env.demo.local
node --env-file=.env.demo.local scripts/seed-demo.mjs
```

The seeder targets http://localhost:3000 and creates clearly marked DEMO catalog records, templates, subscriptions, invoices and sample receipts. It queues sample invoice emails to Mailpit; **no real money moves**. IDs and retained payment request keys are written to the ignored `.env.demo.data.json` with owner-only permissions.

Keep the manifest when rerunning. The script reuses its records rather than resetting edited lifecycle states; inspect any failure before deliberately rerunning. Never commit either demo environment file or the manifest.

## Try the main workflows

1. **Admin:** create a product, optional variant/tax, recurring plan and customer. Optionally save a quotation template.
2. **Subscription:** create a draft under `/admin/subscriptions`, inspect the server quotation, then quote, confirm and activate it. A template copies editable inputs; it does not bypass server validation.
3. **Billing:** let the worker process due periods or deliberately run the bounded billing action. If pause/closure reports `BILLING_DUE`, reconcile due billing before retrying the transition.
4. **Invoice:** open `/portal/invoices`, confirm a draft and record a partial or full manual receipt. After an uncertain payment response, reconcile the ledger or deliberately retry the **same saved intent**, not a new request key.
5. **Email/print:** queue an invoice email, inspect its current SMTP state and check Mailpit. Queue acceptance and SMTP acceptance do not guarantee inbox delivery. Use the invoice print button for the saved financial document.
6. **Customer:** sign up a separate account, create subscriptions for its automatically linked customer record, then sign in in a private window. Verify it sees only its own subscriptions/invoices and permitted lifecycle actions—not admin or finance data.
7. **Recovery/reporting:** request a password reset and follow its Mailpit link. In `/finance`, change date/customer filters and inspect the payment ledger. Historical date filters do not turn current balances into historical balances.

## Development

### Frontend

Use Node **24+** as in the Docker image; `package.json` allows Node 22+. Stop the Compose **web** service if it is already occupying port 3000, without stopping the API or database:

```bash
docker compose stop web
docker compose up --build -d postgres mailpit migrate api worker
npm ci
npm run dev
```

Next.js loads the root `.env`; `BACKEND_URL` points the `/api` proxy at the Go API. `APP_ORIGIN` must match the exact browser origin, including scheme, hostname and port. Do not mix `localhost` and `127.0.0.1` during one login/reset flow.

### Native Go API and worker

The module requires **Go 1.26+**; the backend Docker image uses **Go 1.27.3**. Start local PostgreSQL and Mailpit, then export the relevant settings from `.env.example` in each backend terminal. **Go does not automatically load `.env`.** Avoid running a native API on port 8080 while the Compose API is using it.

From `backend/`:

```bash
go mod download
go run ./cmd/server migrate
go run ./cmd/server create-admin
go run ./cmd/server serve
```

Run the worker in a separate terminal with the same database/configuration:

```bash
go run ./cmd/server worker
```

`create-admin` additionally needs exported `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Both API and worker use the same Go codebase and database; they are separate processes, not separate business services.

### Configuration

| Setting | Purpose |
| --- | --- |
| `POSTGRES_PASSWORD` | Initial local Compose database password |
| `DATABASE_URL` | Native Go PostgreSQL connection; Compose supplies its internal connection |
| `APP_ORIGIN` | Exact allowed web origin; also used in password reset links |
| `APP_CURRENCY` | One configured three-letter currency, initially `INR` |
| `BACKEND_URL` | Native Next.js API proxy target; the Docker image uses `http://api:8080` |
| `HTTP_ADDR` | Native API listener, initially `127.0.0.1:8080` |
| `SMTP_HOST`, `SMTP_PORT` | Native SMTP connection, initially local Mailpit |
| `COMPOSE_SMTP_HOST`, `COMPOSE_SMTP_PORT` | Container SMTP routing, initially `mailpit:1025` |
| `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | SMTP TLS/authentication/sender configuration |

Current setup uses **Mailpit only**, not Gmail or external delivery. Real SMTP and a public deployment require separate operator configuration.

## Architecture and billing rules

```text
Browser → Next.js /api proxy → Go API → PostgreSQL
                                  Go worker → PostgreSQL outbox → SMTP/Mailpit
```

Go owns authentication, authorization, validation, lifecycle transitions, exact billing and reports. React uses typed contracts and client calls; it does not access PostgreSQL or calculate invoice totals. Direct parameterized SQL, decimal arithmetic, row locks, unique constraints and transactional email enqueue keep the implementation explicit.

**Why Go?** One compiled application supports both HTTP and worker commands, with straightforward cancellation/timeouts and concurrent request/job processing. PostgreSQL transactions and constraints—not Go alone—provide durable multi-process billing safety. This is a design choice, not a claim of measured production performance.

Important defaults:

- One business, one currency and UTC calendar dates.
- Plan price is a recurring base fee **plus** product/variant lines; the base fee is tax-free in this baseline.
- Periods include their start and exclude their end. Month-end anchors are retained; shortened final periods are billed in full, with no proration/refunds.
- At most one eligible discount is chosen per invoice; its cap is consumed atomically when the invoice is generated.
- Future subscriptions do not bill early. Paused/expired subscriptions are not counted as currently active.
- Billed and collected are period flows; active, outstanding and overdue are current snapshots. These are not MRR or recognized accounting revenue.
- Manual payment recording does not integrate a payment gateway. Email delivery is at least once and can duplicate after a crash around SMTP acceptance.

### Rate limits and retry safety

- Authenticated accounts share **300 reads/minute** and **60 mutations/minute** across their sessions and API processes. PostgreSQL holds the atomic fixed-window counters; these initial budgets are provisional, not measured capacity limits.
- Authentication additionally allows **15 login attempts per email**, **5 signup/reset requests per email**, and a shared **500 auth requests**, each per 15-minute window. Logout bypasses these budgets so users can still sign out.
- Rejections return `429 RATE_LIMIT` with a database-expiry-derived `Retry-After`. These are application controls, not perimeter/DDoS protection; anonymous per-IP controls require a correctly configured trusted proxy. Fixed windows allow boundary bursts and incur a database write per authenticated request.
- The browser does **not** automatically retry HTTP mutations. On an uncertain payment or draft creation, retain the original immutable input and UUID; use only the explicit exact-recovery action. Draft creation has an optional actor-scoped `request_key`; a changed payload with the same key returns `409`. Its browser recovery requires local storage and Web Locks support in a modern browser.
- Only keyed draft transactions may restart on known PostgreSQL serialization/unique-reservation conflicts, with at most **three total attempts**. Ambiguous commit/network errors and unkeyed writes are not automatically retried.
- SMTP failures receive at most **eight attempts**, with exponential delays from one minute, capped at 64 minutes. Billing catch-up runs in bounded batches with unique periods. SMTP remains at least once, not exactly once.

Existing request helpers, direct SQL, transaction boundaries and the durable outbox meet these needs. No Kafka, generic repository layer, CQRS, event sourcing or circuit breaker was added for speculative growth.

## Repository layout

```text
backend/cmd/server/                 API, worker, migration and admin CLI entry point
backend/internal/app/               Domain, HTTP handlers, SQL and worker logic
backend/migrations/                 Numbered PostgreSQL migrations
src/lib/                            Shared typed contracts and API client
src/features/admin-ui/              Catalog, templates and admin subscription workflows
src/features/portal-finance-ui/     Authentication, customer portal, payments and finance
src/components/                     Shared shell and UI primitives
src/app/                            Next.js routes and global styles
scripts/seed-demo.mjs               Explicit local-only demo setup
```

`plan.md` records contracts, decisions and verification history. `DESIGN.md` describes the shared UI system. `AGENTS.md`, `shaheem.md` and `alfred.md` define contributor boundaries; automated agents must follow those instructions.

## Checks and verification

Frontend, from the repository root:

```bash
npm run typecheck
npm run build
```

Backend, from `backend/`:

```bash
go build ./...
go test ./...
go test -race ./... -count=1
```

The PostgreSQL HTTP integration workflow is **opt-in**. Provision a fresh, empty, disposable database named `brightloop_test_*`, export its connection as `TEST_DATABASE_URL`, then run the backend tests. It applies migrations and refuses an already initialized database. Recreate only that disposable database between runs; **never use the demo or business database**. Without the variable, the database workflow is skipped, not passed.

Builds, backend unit/race/integration checks and selected isolated desktop/mobile/keyboard workflows have passed during development. Those results do not establish exhaustive security/accessibility coverage, production readiness or the requirement that every page loads in under two seconds at scale.

## Troubleshooting and deployment boundaries

- Inspect services with `docker compose ps` and `docker compose logs api worker migrate web`.
- **Port already allocated:** identify the owning process/project. Do not delete unrelated containers or data; choose a free local port and update related origin/proxy configuration consistently.
- **Reset/invoice email missing:** the worker must be running. Inspect Mailpit and invoice email status; a successful queue request is not proof of delivery. Exhausted retries require deliberate operator recovery.
- **403 on mutation:** check the signed-in role and exact `APP_ORIGIN`; customer ownership is enforced by Go, not just hidden controls.
- **Database startup failure:** check connectivity and whether the persisted volume was initialized with different credentials. Do not remove the volume as a routine fix.

Compose defaults bind development ports to loopback. Before public use, configure HTTPS/secure cookies, private database networking, a restricted runtime database role, strong secrets, backups, monitoring and suitable SMTP. No public deployment or real payment processing is included in the local setup.

The requirements PDF is not a runtime dependency. The implementation and business defaults are documented here and in `plan.md`; the original PDF is not bundled in this repository.

## Contributors

- **Mathew Joseph:** Go backend, PostgreSQL, shared contracts, infrastructure and integration.
- **Muhammed Shaheem:** admin/staff workflows and the shared responsive design system.
- **Alfred:** authentication presentation, customer portal, invoices/payments and finance UI.
