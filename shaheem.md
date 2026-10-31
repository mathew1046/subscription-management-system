# Shaheem — Admin/staff UI work

## Start here

Read `AGENTS.md`, `plan.md`, `.agents/skills/choose-backend-patterns/SKILL.md` and `.agents/skills/build-subscription-core/SKILL.md`. Work only on **`feat/shaheem-admin-ui`**, starting from the latest foundation on main. No time estimates. Do not add/run tests, testing tools, CI or extra documentation unless Mathew asks.

```sh
git fetch origin
git switch feat/shaheem-admin-ui
git merge origin/main
npm ci
npm run dev
```

If this branch does not exist locally, use `git switch --track origin/feat/shaheem-admin-ui`. Follow the local self-hosted service setup in plan.md. Never resolve a conflict by overwriting Mathew's contracts or Alfred's work.

## Ownership and available foundation

Own `src/features/admin-ui/**`, `src/app/admin/**`, `src/components/**` and `src/app/globals.css`. Coordinate any root layout change with Mathew. Mathew owns `backend/**`, `src/lib/**`, package/lockfiles, infrastructure and backend behavior. Alfred owns portal/auth/finance pages. Shared component changes must retain compatibility with Alfred's imports.

Already provided: workspace navigation, Button/Field/Panel/Notice/Status primitives, paginated ResourceTable, authenticated API client, DTOs, functional record-list pages and the Go endpoints. Your job is to turn this foundation into complete, polished admin/staff workflows—not to replace the server.

## Ordered deliverables

### 1. Shared design and navigation

- Refine the existing neutral/teal visual system: consistent typography, spacing, table density, status badges and responsive sidebar.
- Add reusable select, textarea, modal/drawer, confirmation and table-toolbar components only where needed.
- Use `api.me()` to tailor visible navigation and controls. Admin sees configuration and staff tools; staff sees customer/subscription operations. Backend remains the authority.
- Coordinate component names/props with Alfred before changing the shared API. Keep keyboard labels/focus and mobile tables usable.

### 2. Products, variants and plans

- Products: list/create/edit/archive; name, type, sale price, cost price and notes. Pass amounts as decimal strings. Do not show cost to customer-facing pages.
- Variants: choose product, name and nonnegative price delta. The example Odoo variant adds 560. Use `api.list/create/update('variants', ...)`.
- Plans: name, recurring base price, cadence, minimum quantity, availability dates and auto-close/close/pause/renew flags. Clearly label the base fee as additional to product lines; zero means line-only pricing.
- Backend PUT expects the complete editable payload. Do not send record IDs, calculated `uses`, or server metadata as update fields.

### 3. Customers and quotation templates

- Customers: list/create/edit name, email and address. Keep account-linkage decisions with Mathew; do not link by guessing user IDs or impersonating customers.
- Templates: choose plan; name/valid-days; repeatable lines of product, optional variant, quantity and optional tax. Validate required fields and matching variant choices for UX.
- Starting a subscription from a template copies its plan and lines into the creation form. Calculate quote validity as a UI date default; submit explicit dates. The backend revalidates prices and configuration.

### 4. Subscription workflow

- List with customer/status filters and pagination; show number, dates, pause/status and due date.
- Detail/create page: customer, plan, start/end, quote-valid-until, payment terms and repeatable product lines. Use `api.createSubscription`; display server-returned prices after saving.
- Add Draft → Quotation → Confirmed → Active transitions using `api.transition`. Show available actions based on status and policy; show server conflict messages clearly.
- Add pause/resume/renew/early-close controls. Renewal needs a later end date; closure asks confirmation. Never treat expired/cancelled records as renew-able merely because a button is visible.
- Explain `BILLING_DUE` when the server requires billing before pause/closure; a staff “Process due billing” action calls `api.runBilling` and reports processed/failed counts.

### 5. Admin settings

- Taxes: name and percentage rate.
- Discounts: fixed/percentage, amount, minimum purchase/quantity, validity, usage cap and optional product scope. Show consumed usage read-only.
- Staff: list and create through `api.staff`/`api.createStaff`; never offer a role selector or store passwords.
- Keep configuration mutation controls admin-only; staff may read configuration for quote preparation.

## Handoff conditions

All owned screens must use the typed API; no production mock success/data. Include loading, empty, validation, API-error and success states. Disable repeated form submission and preserve entered data on errors. Never calculate authoritative totals, discount eligibility or permissions in the browser. Keep changes in your feature branch and open a PR to main for Mathew.

If blocked, report the exact client function, request/response mismatch and affected screen. Do not change shared contracts or add a new backend. Finish independent UI work while Mathew resolves the interface.

Allowed compilation check: `npm run typecheck` or `npm run build` when useful. No automated/manual testing passes without Mathew's instruction. State what was implemented and what remains unverified.
