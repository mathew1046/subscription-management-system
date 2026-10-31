# Brightloop — Paper & ink

Implementation contract: selected by the user from rendered direction previews on 2026-10-31. The finished system will be documented from the implementation before handoff.

## Visual system

- Light, restrained operational workspace: paper `#fcfcfb`, white panels, ink `#202523`, muted `#636d66`, rules `#dfe3de`, green `#0d7c66`. No gradients, glass, decorative metric cards or invented totals.
- Use the local system/Arial sans stack. Headings 36–42px desktop, 28–32px mobile, tight tracking; body 14–16px; tabular money and dates. No external fonts or image services.
- Desktop: 250px light navigation rail; fluid main with 40–60px gutters, an 86px contextual header, generous heading/action row, controls, then readable tables. The selected subscription preview is the composition reference, not a source of production demo rows.
- Mobile: compact brand/header and accessible navigation drawer, 20px gutters, stacked forms/actions, tables in labelled horizontal scroll regions. Nothing depends on hover.
- Spacing scale 4/8/12/16/24/32/48/64px. Controls >=40px; 44px touch actions on mobile. Corners 6px controls, 10px restrained containers. Prefer rules and whitespace to nested cards.
- Reusable loop-shaped vector service mark with lowercase wordmark. One restrained green navigation selection; charcoal primary buttons. Secondary outlined actions; danger actions explicitly labelled and confirmed.
- Status is always text plus a restrained colour treatment. No green success before server confirmation. Errors retain form inputs and include useful server messages.
- Native labelled input/select/textarea controls; shadcn/ui-style Radix Dialog composition provides focus trapping, Escape, accessible title/description and focus restoration. Keep existing Button/Field/Panel/Notice/Status exports compatible with Alfred's imports.
- Motion only for menu/dialog transitions, 120–160ms; respect reduced motion. Strong visible keyboard focus and >=4.5:1 ordinary text contrast.

## Shared implementation interfaces

`@/components/ui` retains Button, Field, Panel, Notice, Status. Add:

- `Select({label, children, ...nativeSelectProps})`
- `Textarea({label, ...nativeTextareaProps})`
- `Modal({open, onOpenChange, title, description?, children})`
- `ConfirmDialog({open, onOpenChange, title, description, onConfirm, pending?, confirmLabel?, error?})`
- Button accepts optional `variant: 'primary' | 'secondary' | 'danger' | 'ghost'` while retaining `className` compatibility.

Feature forms use `.page-heading`, `.page-title`, `.page-description`, `.toolbar`, `.form-grid`, `.form-section`, `.form-actions`, `.actions`, `.button.secondary`, `.table-wrap`, `.empty-state`, `.detail-grid`, `.detail-list`, `.line-editor`, `.line-row`, `.checkbox-field`, `.text-muted`, `.text-link`, `.status`, `.pagination`. Native controls inherit shared styles.

`@/features/admin-ui/shared` provides `useAdminSession()` returning `{user, loading, error, reload}`, `LookupSelect({resource, label, value, onChange, optional?, disabled?, productId?})` for resources products/variants/plans/taxes/customers/quotation-templates, and `LineEditor({value, onChange, disabled?})` using typed line inputs. Lookup controls explicitly paginate; never truncate silently to the first hundred records.

## Scope and data authority

All views use `src/lib/client.ts` and contracts unchanged. Prices remain decimal strings; quote/invoice totals come from Go. UI gating improves presentation, never replaces server authorization. No fake live data, customer-account linking, secrets in source, new backend abstraction, external service or teammate-owned page logic.

Three non-overlapping implementation lanes: shared components/CSS/navigation; catalog/settings screens; subscription list/create/detail/lifecycle. Leader owns dependencies, shared admin lookups/session, route dispatch, design artifacts and integration. Separate worktrees; commits credit Muhammed Shaheem while preserving the actual committer. No automated/manual test passes unless authorized; build/type checks allowed.
