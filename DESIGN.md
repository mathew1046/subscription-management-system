---
name: Brightloop — Paper & ink
description: A light, ruled workspace for clear subscription operations.
colors:
  paper: "#fcfcfb"
  surface: "#ffffff"
  surface-subtle: "#f5f6f3"
  ink: "#202523"
  muted: "#636d66"
  line: "#dfe3de"
  control-line: "#828e85"
  accent: "#0d7c66"
  accent-ink: "#08624f"
  accent-soft: "#e9f3ed"
  danger: "#a62d29"
  danger-soft: "#fcf0ee"
  status-neutral: "#59635b"
  status-neutral-bg: "#f6f7f4"
  status-positive: "#2c6946"
  status-positive-bg: "#edf6ef"
  status-positive-line: "#cde0d3"
  status-info: "#3e6075"
  status-info-bg: "#f0f5f8"
  status-info-line: "#d3dfe7"
  status-warning: "#805d24"
  status-warning-bg: "#fbf5e9"
  status-warning-line: "#e8d8b9"
  status-danger-line: "#eacbc7"
  status-closed-bg: "#f1f2ef"
typography:
  headline:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "42px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.035em"
  headline-mobile:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  description:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.5
  table-heading:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0.055em"
rounded:
  control: "6px"
  container: "10px"
  status: "5px"
spacing:
  xs: "4px"
  sm: "8px"
  control-gap: "12px"
  md: "16px"
  compact: "20px"
  lg: "24px"
  panel: "28px"
  xl: "32px"
  gutter: "48px"
  wide: "64px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "10px 17px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 17px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "10px 17px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 17px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
  nav-selected:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
  status-active:
    backgroundColor: "{colors.status-positive-bg}"
    textColor: "{colors.status-positive}"
    rounded: "{rounded.status}"
    padding: "3px 9px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.container}"
    padding: "28px"
  notice-error:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.container}"
    padding: "32px"
---

# Design System: Brightloop — Paper & ink

## Overview

**Creative North Star: "Paper & ink"**

Brightloop is a minimal, professional workspace: near-white paper, a white navigation rail, charcoal headings and primary actions, and restrained green wayfinding. Thin rules and generous section spacing organise dense operational records without turning every group into a card. The loop mark and lowercase wordmark supply identity; no decorative imagery is needed.

This is the finished implementation contract, extracted on 2026-10-31 from `src/app/globals.css`, `src/components/` and the admin feature components. It replaces the provisional direction values with built values. The approved code-led preview (seed `b221723e`, `model-pick`) establishes the world, not production rows or unbuilt controls. The finish reviewer returned **ship (9/10)** across the supplied desktop list/detail and mobile list/create/drawer/dialog captures. That bounded review is not a whole-product accessibility, performance or production-readiness claim.

**Key Characteristics:**
- Paper backgrounds, white surfaces, fine neutral rules.
- Charcoal actions; green selection, links and keyboard focus.
- Compact labelled records beneath generous page headings.
- Native fields, explicit feedback and text-labelled status.
- A persistent desktop rail that becomes a mobile drawer.

## Colors

The palette is predominantly warm-neutral; green directs attention without becoming a large decorative fill. The frontmatter is normative; the first twelve color names map directly to the same-named CSS custom properties in `src/app/globals.css`.

### Primary
- **Service green (`accent`)** identifies the mark, wordmark period, focus outline, checkbox accent and text caret.
- **Deep green (`accent-ink`)** makes links and the selected navigation label readable against **green wash (`accent-soft`)**. The wash also supports confirmed success notices; it is not the default button fill.

### Neutral
- **Paper (`paper`)** is the workspace; **white (`surface`)** is the rail, fields, panels and dialogs.
- **Soft paper (`surface-subtle`)** distinguishes hover, read-only and disabled surfaces without elevation.
- **Charcoal (`ink`)** carries headings, body text and primary buttons; **quiet ink (`muted`)** carries descriptions, dates' labels and reference metadata.
- **Rules (`line`)** divide records and sections. **Control stroke (`control-line`)** is deliberately stronger for field and secondary-button boundaries.

### Semantic feedback
- **Danger / danger wash** distinguish destructive actions and errors. They are not decorative accents.
- Status families use the `status-positive`, `status-info` and `status-warning` foreground/background/line trios. Positive: Active, Paid, Available, Sent. Informational: Confirmed, Quotation, Queued. Warning: Paused, Overdue, Retrying.
- Cancelled, Failed and Error use danger colors plus `status-danger-line`. Closed, Archived and Inactive use muted ink on `status-closed-bg`. Other states, including Draft, use the neutral badge colors and standard rule.

**The Meaning Before Color Rule.** Always render the state or outcome in words; color never stands in for saved lifecycle, pause, closure or delivery state.

## Typography

All roles use the local **Arial, Helvetica, sans-serif** stack. No remote font, display face or separate numeral font is loaded. Tight heading tracking creates hierarchy; regular sentence-case body copy keeps the workspace matter-of-fact.

- **Page headline:** `headline`; reduces to 36px at widths up to 900px, then `headline-mobile` at up to 600px. Page-title bottom margin is 12px.
- **Section title:** `title`; becomes 18px on small screens. Third-level headings are 16px, weight 600, line-height 1.4.
- **Body / description:** `body` for general copy; `description` for page summaries, limited to 72ch. Page summaries become 13px on small screens.
- **Field label:** `label`; help copy is 12px with line-height 1.6. Native controls are 14px/1.5 on desktop and 16px on small screens.
- **Table heading:** `table-heading`, uppercase. Data cells are 13px/1.65. Reference metadata is 11px; status text is 11px, weight 500, line-height 1.6.
- **Dialog title:** 25px/1.3, weight 600, tracking -0.025em; 22px on small screens.
- Tables, detail values, pagination summaries and financial amounts use `font-variant-numeric: tabular-nums`. Long headings and identifiers wrap rather than expand the page.

## Layout

The workspace is fluid, not a centred fixed-width dashboard. Desktop uses a sticky, full-height rail (250px) beside `minmax(0, 1fr)` content. Its brand and contextual header share an 86px height; main gutters are 48px and content begins 43px below the header. Bottom space is 64px. The page-heading row places the title/description opposite the primary action, with a 24px gap and 32px below it.

Responsive changes come from the built media queries, not inferred device classes:

| Viewport | Implemented change |
| --- | --- |
| At least 1600px | Main side gutters increase to 64px. |
| Up to 1200px | Main side gutters reduce to 32px; generic line rows use two columns. |
| Up to 900px | Rail hides; menu button opens the drawer. Main gutters are 24px, header 72px, content top space 32px. |
| Up to 600px | Gutters are 20px, bottom space 40px, header 68px, content top space 28px. Heading/actions stack; the heading's standalone action stretches. Forms/details become one column. |

Two-column form grids use a 24px column gap; fields have 20px bottom spacing and 8px label/control gaps. Sections finish with a rule, 24px bottom padding and 32px separation. Detail grids use 32px gaps (24px on small screens); label/value rows use a 42% label track with a 100px minimum, a 16px gap and 12px vertical padding. Repeatable product lines are numbered blocks containing the same form grid, not a compressed desktop-only spreadsheet.

Filter toolbars wrap at 12px gaps, with 180px field bases capped at 300px. Small-screen native toolbar fields stretch; custom lookup wrappers retain their own sizing. Tables retain a 640px minimum width inside labelled, focusable horizontal scroll regions; do not hide financial columns to fit. Headings and cells use 18px vertical / 16px horizontal padding (16px vertical on small screens), with 20px at outer edges. Pagination wraps without inventing a total count.

Print styles remove navigation, dialogs, controls and toolbars, flatten panels, allow the table to fit the page, repeat table headers and avoid row breaks. They specify 16mm page margins and 11pt body text; this is a CSS contract, not a print-validation claim.

## Elevation & Depth

**The Flat Workspace Rule.** Resting records and editor panels use rules and white/paper contrast, not shadows. Nested panels flatten into ruled sections instead of accumulating bordered cards.

The only shared shadow is `--dialog-shadow`: `0 16px 64px rgb(18 28 22 / 18%)`, used by dialogs and the navigation drawer. Their overlay is `rgb(22 30 25 / 35%)`, at z-index 50; content is at 51. The skip link sits above both at 100.

Motion is limited to entrance feedback: overlay fade and dialog fade/6px rise (140ms ease-out), drawer fade/16px slide (150ms ease-out). There is no ambient animation or button translation. Reduced-motion CSS forces animation and transition durations to .01ms, one iteration, and automatic scroll behavior.

## Shapes

Controls and navigation selections use `rounded.control`; panels/dialogs use `rounded.container`; badges use `rounded.status`. All use fine 1px borders where present. The identity avatar is a small circle (34px), not a reusable card motif. The service mark is an open, round-capped double loop, not an image asset or a filled monogram.

Focus is a green 2px outline with 4px offset on interactive elements. Desktop buttons/fields normally have a 42px minimum height; compact pagination and lookup controls are 36px and table ghost actions 34px. At up to 600px, base buttons, icon buttons, pagination buttons and native text controls become at least 44px high; specific compact table/lookup rules remain separate. Do not claim every control has an identical hit area.

## Components

### Brand and navigation

`Brand({onNavigate?})` in `src/components/workspace-shell.tsx` links home with the accessible name “Brightloop home”. Preserve its exact inline SVG: a 32px square, viewBox `0 0 32 32`, paths `M13 4h5a9 9 0 0 1 0 18h-4` and `M19 28h-5a9 9 0 0 1 0-18h4`, 2.8px round-capped strokes. The charcoal `brightloop` wordmark is 25px/1, weight 700, tracking -0.035em; its terminal period and loop are green.

Navigation uses 18px line icons (stroke 1.7), 13px labels and 42px rows with 9px/12px padding. Group headings are 11px uppercase, weight 600, tracking .045em. Selected links use green wash/deep green and `aria-current="page"`; hover is soft paper. The footer holds identity, role and sign-out/error state. Session loading/failure is explicit rather than showing invented identity. Role-tailored navigation is presentation, not authorization.

The mobile drawer reuses the rail contents in a Radix Dialog. Its width is `min(310px, calc(100vw - 32px))`; it has its own scrollable navigation and a labelled close button. The mobile top bar is context plus menu, not a second logo lockup.

### Buttons

Confident and quiet: 13px, weight 600, line-height 1.45, 8px icon gap, 10px/17px padding, a transparent 1px border and the control radius. Primary is charcoal/white (hover `#353d38`, active `#111713`). Secondary is white/ink with the control stroke (hover soft paper and `#6f7f73` border). Danger is red/white (hover `#89231f`). Ghost is transparent/ink (hover soft paper). Disabled buttons use .5 opacity and a not-allowed cursor. Use clear action text, not icon-only ambiguity.

### Fields and repeatable lines

`Field`, `Select` and `Textarea` wrap native controls in visible labels. Text controls use white, the control stroke (`#828e85`, 3.41:1 against white), 9px/12px padding and the control radius; selects leave 30px on the right. Textareas start at 112px high and resize vertically. Hover strengthens the stroke (`#66766b`); disabled/read-only controls use soft paper; `aria-invalid="true"` uses the danger stroke. Native checkboxes/radios are 17px and green-accented.

`LookupSelect` pages choices in batches of 25, shows page/loading/error/retry states and retains selected-record labels across pages. Product-specific variants require a product first; empty matching pages remain navigable. `LineEditor` provides numbered blocks, labelled product/variant/quantity/tax fields, add/remove actions and pending disabling. No client-computed charge preview replaces saved server totals.

### Tables and detail records

Rows sit directly in the workspace under a pale header (`#f7f8f5`) and thin rules; hover is `#fafbf8`, not elevation. References are underlined links with subordinate record identifiers. Use real table captions/headers and labelled scroll containers. `ResourceTable` supplies five static skeleton rows, loading announcement, error/retry, empty message and Previous/Next controls. Catalog lists use their existing notice/empty/pagination states instead of pretending to share the skeleton implementation.

Lifecycle detail keeps the saved Draft → Quotation → Confirmed → Active → Closed sequence readable, with the current stage labelled in text. Pause, cancellation and effective date state remain separate labels. Term and policy snapshots are ruled definition lists; quoted charges are server-returned tables. Avoid a decorative progress wizard that implies a completed action.

### Panels, notices and status

`Panel` is a white, ruled editor/container with 28px padding (20px on small screens); it is not a mandatory wrapper around every section. Auth panels retain their own 32px/24px padding. `Notice` uses subtle paper, 12px/16px padding and 13px/1.65 text; errors switch to danger wash and an alert role. Standard notices, including saved-success copy, use a status role; the component does not accept a success variant. Existing `.notice.success` styling is a CSS hook only.

`Status` renders compact, non-interactive text badges (3px/9px padding) and derives the state class from string children. Keep the foreground/background/border families in Colors; neutral fallback must still say what the record is.

### Dialogs and confirmation

`Modal` and `ConfirmDialog` use Radix Dialog semantics, overlay, focus containment and dismissal. The centred dialog is `min(640px, calc(100vw - 40px))`, with 32px padding and a scrollable maximum height of viewport minus 48px. Confirmation is capped at 480px. Small screens use viewport minus 32px for width/max-height and 24px padding. The action row is ruled, right-aligned, spaced 12px; mobile uses 10px gaps and growing buttons.

Confirmation initially focuses **Cancel**, restores the previously focused connected element on close, reports errors in place, and prevents duplicate confirmation with an in-flight guard. While confirmation is busy, actions and close are disabled and Escape/outside dismissal is blocked. Generic `Modal` has no pending prop; do not assume it has that guard. State the affected record and consequence; never replace an uncertain result with a success message.

### Shared implementation contracts

Preserve these exports from `@/components/ui` for existing admin, portal, finance and auth consumers:

```ts
Button({className = '', variant, ...props}: ComponentProps<'button'> & {variant?: 'primary' | 'secondary' | 'danger' | 'ghost'})
Field({label, ...props}: InputHTMLAttributes<HTMLInputElement> & {label: string})
Select({label, children, ...props}: SelectHTMLAttributes<HTMLSelectElement> & {label: string})
Textarea({label, ...props}: TextareaHTMLAttributes<HTMLTextAreaElement> & {label: string})
Panel({title, children}: {title: string; children: ReactNode})
Notice({children, error = false}: {children: ReactNode; error?: boolean})
Status({children}: {children: ReactNode})
Modal({open, onOpenChange, title, description?, children})
ConfirmDialog({open, onOpenChange, title, description, onConfirm, pending?, confirmLabel?, error?})
```

`Modal` takes boolean `open`, `(open: boolean) => void` for `onOpenChange`, string `title`, optional string `description`, and ReactNode `children`. `ConfirmDialog` requires string `description` and `onConfirm: () => void | Promise<unknown>`; optional `pending` defaults false, `confirmLabel` defaults “Confirm action”, and `error` is an optional string. `Button` preserves native props and legacy `className` styling such as `secondary`.

`@/features/admin-ui/shared` retains `AdminSessionProvider({children})`, `useAdminSession(): {user: User | null; loading: boolean; error: string; reload: () => void}`, `LookupSelect({resource, label, value, onChange, optional?, emptyLabel?, disabled?, productId?})`, and `LineEditor({value, onChange, disabled?})`. Lookup resources are products, variants, plans, taxes, customers and quotation-templates; value and onChange use string IDs. Line values are arrays of `z.input<typeof lineInput>` from the shared contracts.

Keep the existing integration hooks: `.page-heading`, `.page-title`, `.page-description`, `.toolbar`, `.form-grid`, `.form-section`, `.form-actions`, `.actions`, `.button.secondary`, `.table-wrap`, `.empty-state`, `.detail-grid`, `.detail-list`, `.line-editor`, `.line-row`, `.checkbox-field`, `.text-muted`, `.text-link`, `.status`, `.pagination`. These are compatibility names, not a reason to duplicate component styling.

## Do's and Don'ts

### Do:
- **Do** reuse the loop mark, lowercase wordmark and restrained green wayfinding.
- **Do** preserve labelled native fields, visible keyboard focus and text-labelled status.
- **Do** keep wide records in labelled horizontal scroll regions and stack forms at the existing breakpoints.
- **Do** show real server-returned totals, saved state, pending work and recoverable errors without discarding input.
- **Do** retain shared component props and CSS hooks for existing portal, finance and auth consumers.

### Don't:
- **Don't** add gradients, glass, ornamental imagery or decorative metric cards to this paper-and-ink workspace.
- **Don't** nest bordered panels when a ruled section expresses the same hierarchy.
- **Don't** hide financial columns, calculate authoritative totals in the browser or present preview/demo rows as production data.
- **Don't** use color alone for state or claim success before the server confirms it.
- **Don't** turn shared presentation work into backend, authorization or teammate-owned page-logic changes.
