# AGENTS.md — Brightloop team rules

Read `plan.md` and your role file before editing. Mathew owns most development, all backend work, final integration and testing decisions. Latest user instructions take precedence.

## Mandatory skills

Read and apply `.agents/skills/choose-backend-patterns/SKILL.md` when making architecture or refactoring decisions. Read `.agents/skills/build-subscription-core/SKILL.md` for subscription, billing, auth, payment or reporting changes. These are repository-local skills available to everyone; if your agent does not auto-discover them, explicitly open the files. Use both to identify the actual problem, select the simplest justified design, and preserve financial/authorization invariants. Do not add every pattern or copy the transcript's in-memory singleton.

Suggested agent instruction: “Read AGENTS.md, plan.md, my role file and both repository-local skills. Work only on my branch and owned files. Implement the next incomplete deliverable. Do not add/run tests or estimate development time.”

## Separate branches are required

- Mathew: `feat/mathew-core` — Go backend, SQL, shared contracts, integration and infrastructure.
- Shaheem: `feat/shaheem-admin-ui` — admin/staff UI and shared design components.
- Alfred: `feat/alfred-portal-finance-ui` — auth presentation, customer portal, finance UI.
- Start/sync each branch from the current `main`. Do not work in another person's branch or share a working directory between concurrent agents; use separate clones/worktrees.
- Commit to your own branch and open a PR to `main`. Mathew owns merges. The initial foundation may be pushed to `main` to unblock the team because the user explicitly authorized it. This is not blanket permission for collaborators to commit directly to `main`.
- Coordinate contract changes with Mathew and shared styling changes with Shaheem. Never force-push or discard another person's work. Do not publish secrets.

## Technical boundaries

- **Go backend + self-hosted PostgreSQL; TypeScript/React frontend. No hosted database/auth/payment/email APIs, Supabase, Firebase, managed backend wrappers or external business services.** Local open-source libraries, Docker images and the standard SMTP protocol are permitted.
- Go implements auth, permissions, validation, state transitions, exact billing, payment recording and reports. TypeScript provides typed client calls and presentation only.
- UI uses `src/lib/client.ts` and `src/lib/contracts/index.ts`. No direct DB access, duplicated financial calculations or client-side permission enforcement as a substitute for backend checks.
- Keep one Go application codebase with separate API/worker commands. Use direct parameterized SQL and domain functions; no speculative microservices, caches, CQRS, event sourcing or generic repositories.
- Freeze shared contracts before dependent UI work. Schema changes require new numbered SQL migrations after the initial migration is deployed.

## Ownership

| Person | Owned paths |
| --- | --- |
| Mathew | `backend/**`, `src/lib/**`, package/lockfiles, Docker/Compose/env/config, repo skills, `plan.md`, `AGENTS.md`, integration |
| Shaheem | `src/features/admin-ui/**`, `src/app/admin/**`, `src/components/**`, `src/app/globals.css`; coordinate root layout changes |
| Alfred | `src/features/portal-finance-ui/**`, `src/app/portal/**`, `src/app/finance/**`, login/signup/forgot-password/reset-password pages |

Existing starter screens are functional foundations, not finished teammate deliverables. Extend them without changing API behavior. Temporary layout examples must be clearly marked and isolated; never display invented success or financial totals as real data.

## Speed and verification policy

**Complete development fast. Never assume or estimate development duration. Do not write, generate or run automated tests, browser/manual test passes, benchmarks, load tests, test fixtures, coverage tooling or CI unless Mathew explicitly requests them.** Do not add extra reports, documentation, speculative features or large refactors. The requested plan/role files/skills are authorized exceptions to the documentation restriction.

Build/type checks and ordinary code inspection to catch compilation/integration errors are allowed. Run only checks justified by changed code. Do not equate a successful build with tested runtime behavior or production readiness. Clearly report deferred verification.

Speed does not waive input validation, hashing, role/ownership checks, transaction safety, idempotency, money precision, error handling or required UI states. These are implementation work.

## Financial and security invariants

- Authenticate each protected request; scope customer reads/writes to their own records. Only admins create staff or change catalog/rules. Never accept a role from signup input.
- Keep credentials, password/reset/session hashes and privileged DB access server-side. Use reviewed Argon2id primitives, opaque sessions, secure cookies in HTTPS deployments and same-origin mutation checks.
- Snapshot subscription terms and invoice financial values. Use decimal strings over HTTP and decimal arithmetic/SQL numeric internally.
- Lock subscriptions/invoices for transitions. Enforce unique billing periods and payment request keys in PostgreSQL; consume discounts atomically. Do not retry non-idempotent writes blindly.
- Keep outbox enqueue and corresponding business write transactional. SMTP delivery is at least once, not exactly once; surface failures without claiming delivery.
- Use finite request/job timeouts, bounded DB pools, pagination, due-date indexes and catch-up batches. The PDF's under-two-second goal remains unverified until Mathew requests measurement.

## Handoff

End work with implemented behavior, any changed interfaces, files touched, build results if run, verification deferred and concrete blockers. Do not send messages to teammates, change repo settings, deploy publicly or create third-party accounts unless separately requested.
