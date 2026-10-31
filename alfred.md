# Alfred — Customer portal and finance UI work

## Start here

Read `AGENTS.md`, `plan.md`, `.agents/skills/choose-backend-patterns/SKILL.md` and `.agents/skills/build-subscription-core/SKILL.md`. Work only on **`feat/alfred-portal-finance-ui`**, starting from main's foundation. Do not estimate build duration or add/run tests, test tools, CI or extra reports unless Mathew asks.

```sh
git fetch origin
git switch feat/alfred-portal-finance-ui
git merge origin/main
npm ci
npm run dev
```

If needed, first create the local tracking branch with `git switch --track origin/feat/alfred-portal-finance-ui`. Follow plan.md for local API/database setup. No external backend accounts or API keys are needed.

## Ownership and available foundation

Own `src/features/portal-finance-ui/**`, `src/app/portal/**`, `src/app/finance/**`, and login/signup/forgot-password/reset-password pages. Shaheem owns shared components/CSS; request reusable changes from him. Mathew owns Go backend, SQL, API contracts/client, infrastructure and integration.

Already provided: functional auth forms, account/session/reset endpoints, own-record subscription/invoice lists, printable invoice view, report overview, typed client/DTOs and common UI primitives. Extend these foundations; do not implement another backend/auth layer.

## Ordered deliverables

### 1. Account presentation

- Polish login, signup, forgot/reset screens and validation feedback. Signup needs name/email and a password of at least 9 characters with uppercase, lowercase and special character.
- Use `api.signup/login/logout/me`; signup creates an account but does not start a session. Redirect after successful login; show clear session-expired feedback on 401.
- Forgot-password always displays the neutral response. Reset reads the token from the URL and calls `api.resetPassword`; never log/store the token. Remove it from the address bar after successful reset.
- Show pending/error states and prevent double submission. Do not store tokens or passwords in localStorage. For local development, reset messages are in Mailpit, not an external inbox.

### 2. Customer subscription portal

- List the authenticated customer's subscriptions with number, plan, start/end, billing date and clear lifecycle/pause/expiry presentation.
- Add a subscription detail view using `api.subscription(id)` showing server-snapshotted lines and plan terms.
- Add permitted pause/resume/renew/close controls through `api.transition`. Renew takes a strictly later end date. Respect plan flags and show API conflicts such as due billing or expired agreement.
- Do not let customers edit customer IDs, prices, taxes, invoices, roles or recorded payments. Server-side ownership filtering is already implemented; UI filtering is not a security boundary.
- A future-start subscription is scheduled, not currently active. A persisted Active record past its end date must be presented as expired for customer clarity.

### 3. Invoice details and print

- Extend invoice list with status/date filters, pagination, overdue indication and links to details.
- Detail: customer snapshot/address, number, issue/due dates, period, status, item descriptions, quantities, unit prices, discounts, taxes, totals, payments and outstanding balance.
- Render amount strings returned by the server; do not recompute invoice totals using floating-point JavaScript.
- Complete browser print layout with company/customer details and all line totals. Preserve the existing print CSS; no PDF generation service needed.
- Customer portal is read-only for invoices/payments. Staff finance controls are separate and role-gated in the UI as well as the API.

### 4. Staff finance actions and payments

- Add invoice confirm/cancel/send actions using `api.invoiceAction`. Ask confirmation for cancellation; do not offer cancellation on paid/partially paid invoices.
- Send success means queued, not delivered. Show that wording explicitly. Repeat calls do not enqueue a second invoice email.
- Payment form: invoice, amount, method, paid date and note. Generate `crypto.randomUUID()` once per payment submission intent and retain it through retries. Generate a new key only for a deliberately new payment; never generate a new key on every network retry.
- Use `api.recordPayment`; refresh invoice/balance from the API after success. Show partial payments and reject overpayment in the UI for convenience while respecting backend validation.
- Do not integrate Stripe/Razorpay or build a gateway checkout. The required workflow records payments already received.

### 5. Dashboard and filters

- Use `api.report({from,to,customer_id})`; show active subscriptions, billed amount, collected payments, current outstanding and current overdue balance.
- Clearly distinguish date-range flow metrics (billed/collected) from current snapshots (outstanding/overdue/active count). Do not label figures as MRR or recognized revenue.
- Link overdue summary to filtered invoices (`status: 'Overdue'`). Use returned pagination instead of fetching all rows to filter locally.
- Add visual comparisons only using real returned values; do not invent a historical trend because the current endpoint does not return a time series. Ask Mathew for an additive endpoint if a trend is required.

## Handoff conditions

Deliver responsive, accessible screens with loading/empty/error/success states and honest queue/session messaging. Keep API calls in the shared client. Do not edit backend, migrations, dependencies or shared DTOs without Mathew's coordination. Use your own branch and PR to main; Mathew merges.

If blocked, report the client method, missing field/behavior and screen. Continue independent presentation work; do not fabricate success responses or create hidden fallback financial data.

Allowed check: type/build compilation when useful. No automated tests or browser/manual test passes without Mathew's instruction. Handoff notes must distinguish implemented UI from verified runtime behavior.
