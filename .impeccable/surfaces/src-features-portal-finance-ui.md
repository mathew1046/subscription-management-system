# Customer portal and finance

## Scope
Authentication, customer subscriptions, invoices, manual payment recording and staff finance reports. Preserve the approved Brightloop Paper & ink world and existing shared components. Mode: Operate.

## User and task
Customers inspect their own agreements and invoices and use permitted lifecycle controls. Staff confirm invoices, record received payments and inspect billed/collected flows separately from current balances. Authentication screens provide clear sign-in and password recovery.

## Visual authority
DESIGN.md and the existing shared shell/components are authoritative. Use restrained paper/ink/green, readable tables, fine separators, meaningful headings and explicit actions. No new visual direction, decorative metrics or invented financial trends.

## Interaction contract
Every protected screen authenticates before loading data. Server role/ownership checks remain authoritative. Retain input on errors, paginate server data, prevent duplicate submission, reconcile ambiguous writes, and preserve each payment key with its exact payload through retries. Render financial strings and snapshots without recomputing totals. Queued email does not mean delivered.

## Responsive and accessible behavior
Support desktop and narrow mobile layouts, 44px mobile actions, labelled controls, keyboard focus, accessible confirmation dialogs and horizontally scrollable data tables with explicit cues. Preserve invoice print layout and reduced motion.

## Verification boundary
Use only the isolated preview API/database and ports for authorized browser checks. Do not touch Mathew's app or data. Capture desktop/mobile in one batched round, fix findings together and use at most one confirmation round. Do not claim production readiness or measured full-page performance from builds.
