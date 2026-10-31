---
name: choose-backend-patterns
description: Inspect backend requirements and code, recognize recurring design problems, and automatically choose the simplest justified combination of repository,factory,singleton,strategy,observer,builder,adapter,decorator,CQRS and circuit breaker patterns. Use when designing backend services, refactoring coupled code, integrating providers, simplifying business rules, separating persistence, or improving dependency resilience. Include an explicit no-new-pattern decision when abstractions are unnecessary.
---


# Choose Backend Patterns

Turn observed problems into small, testable design decisions. Optimize for understandable code, maintainability, extensibility, and reliability. Do not optimize for the number of patterns used. Treat “best” as the best supported choice under the current constraints, not a universal guarantee.

## Repository execution policy

Read root AGENTS.md first. In this repository, do not write or run tests, benchmarks or CI unless Mathew explicitly asks. Apply the verification guidance below only within that permission; build/type checks and code inspection are allowed. Keep Go + self-hosted PostgreSQL for the backend. Never estimate build duration.

## Operating procedure

1. Establish scope: determine whether the request is for advice, review, implementation, or refactoring. Inspect relevant repository instructions, framework conventions, dependency versions, entry points, services, data access, integrations, and existing tests. Read actual call paths before diagnosing from class names.
2. Identify evidence: record the concrete requirement or file/function exhibiting duplication, coupling, unsafe lifecycle, complex construction, divergent workloads, or dependency failure. Distinguish observed problems from assumptions and hypothetical growth.
3. Record constraints: preserve public contracts, business invariants, authorization boundaries, transaction semantics, budget, delivery scope, and existing architecture. Use available requirements and measurements; do not invent traffic or failure statistics.
4. Consider the simplest baseline first: a function, small conditional, named parameters, existing ORM facility, middleware, dependency injection, or current CRUD design may already solve the problem.
5. Apply the decision gates and pattern matrix below. Select the smallest useful set, including none. Resolve overlapping candidates by the responsibility they isolate.
6. Act within scope: for implementation requests, make the selected change and verify it; for design/review requests, provide a concrete recommendation without silently modifying code. Do not stop at a menu of alternatives when enough evidence exists to decide.
7. Report the chosen approach, evidence, simpler alternative considered, tradeoff, and actual verification. State uncertainty and what evidence would change the choice.

Proceed with reversible local implementation decisions without repeatedly asking permission. Ask only when a missing requirement materially changes correctness, externally visible behavior, or an irreversible action. This skill does not authorize deployments, purchases, destructive migrations, or communications.

## Decision gates

Evaluate each candidate independently:

- **Problem gate:** Require a demonstrated pain point or explicit requirement. A single reliable dependency can justify a circuit breaker; do not require duplicated code for every pattern.
- **Benefit gate:** Identify a concrete benefit such as fewer change sites, an isolated external contract, independent algorithm tests, or bounded failure propagation.
- **Simplicity gate:** Prefer existing language/framework mechanisms if they provide the same benefit with less machinery. Do not wrap every component merely for uniformity.
- **Correctness gate:** Preserve consistency, security, resource ownership, and failure semantics. Reject a pattern if its necessary guarantees cannot be met.
- **Scope gate:** Keep implementation proportionate to the task and team's operational capacity. Do not introduce new infrastructure for speculative scale.

Classify candidates as **adopt**, **defer pending evidence**, or **reject for this task**. If two solutions provide comparable benefits, choose the one with fewer moving parts and easier rollback. Do not manufacture numerical confidence scores or weighted rankings from missing data.

## Recognition and selection matrix

| Pattern | Recognize this evidence | Select this minimal design | Prefer a simpler option or defer when |
| --- | --- | --- | --- |
| Repository | Services/controllers repeat persistence details or mix queries with substantial business rules; domain tests require isolation from storage. | Introduce a domain-focused persistence boundary; keep database operations behind it and business policy outside it. | CRUD is thin, or the ORM already provides a sufficient boundary. Avoid a generic wrapper that simply renames every ORM method. |
| Factory | Provider/object construction is duplicated or configuration selects among implementations with different setup needs. | Centralize construction and configuration at the composition boundary; return a shared contract. | One simple implementation or an existing dependency-injection registration already handles construction. |
| Singleton lifecycle | One reusable, expensive, thread-safe resource is needed across requests within one process/container lifecycle. | Let dependency injection manage shared lifecycle and cleanup. Prefer immutable configuration and safe shared clients/pools. | State belongs to a request, tenant, user, or transaction; concurrency safety is unclear. Never use a singleton to hide dependencies. |
| Strategy | Multiple algorithms implement the same operation; a growing conditional mixes independently changing business rules. | Extract interchangeable functions/objects behind a small contract and make selection explicit. | A short stable conditional is clearer; alternatives do not share meaningful semantics. |
| Observer | One domain event causes multiple independently evolving reactions and the publisher need not know each handler. | Publish an explicit event and register handlers; choose synchronous versus durable asynchronous delivery from requirements. | Work must succeed atomically together, ordering is essential, or direct calls remain simpler. Do not equate local observers with durable messaging. |
| Builder | Construction has many optional values, multiple meaningful stages, or cross-field invariants that are difficult to express safely. | Provide explicit construction steps and a final validation/build boundary. | Named arguments, an options object, or a validated data class solves readability without a builder. |
| Adapter | External APIs, SDKs, legacy systems, schemas, or errors leak into domain code. | Translate each external contract into a domain-facing interface at the integration boundary. | The boundary is already isolated and another wrapper adds no useful translation. |
| Decorator | Logging, caching, metrics, authorization, or another composable concern obscures core behavior. | Wrap the same contract and delegate; use existing middleware/interceptors when suitable. | A local helper suffices, or behavior order and ownership become less clear through wrapping. |
| CQRS | Read and write models have concretely different needs, complex write invariants, or measured optimization pressure that simpler tuning cannot address. | Separate command and query responsibilities first, potentially within one application and database. | The application is ordinary CRUD or only speculative scale motivates separate stores. Read-heavy traffic alone does not require CQRS. |
| Circuit breaker | Remote failures or latency consume local resources, or a stated availability requirement needs fast failure during dependency outages. | Use a supported breaker with timeouts, bounded probes, and explicit fallback/error behavior per dependency. | Timeouts and bounded retries already meet the requirement and breaker state adds no benefit. Do not use it to conceal programming or validation errors. |

## Resolve overlaps and combine deliberately

- Use a **factory** to choose/create an implementation, a **strategy** to vary an algorithm, and an **adapter** to translate a foreign contract. A payment integration may need all three, but implement only the responsibilities actually present. Do not add three layers with identical pass-through methods.
- Use a **repository** for persistence boundaries and an **adapter** for external system translation. Keep transaction ownership explicit when repositories cooperate; moving queries does not make database migration free.
- Use a **decorator** around an operation and an **observer** for reactions to an event. They differ in invocation and failure semantics; do not substitute fire-and-forget listeners for required inline validation.
- Use a **builder** for complex instance construction and a **factory** for selecting/creating an implementation. Optional fields alone rarely justify both.
- Treat a **singleton** as a lifecycle choice independent of the other patterns. A process-local instance is not a cluster-wide singleton, distributed lock, or uniqueness guarantee. Never retain request-scoped dependencies in a longer-lived instance.
- Combine **CQRS** and events only when projections are warranted. CQRS does not require event sourcing, a message broker, microservices, or separate databases.
- Put a **circuit breaker** around the remote boundary, often an adapter. Scope failure state so one unhealthy provider does not disable healthy unrelated providers or tenants.

## Correctness rules for implementation

### Persistence and events

Keep multi-step invariants within a deliberate transaction/coordination boundary. Decide which reactions must complete before returning success. For example, inventory reservation may be mandatory while analytics can be asynchronous; do not assume all order reactions are optional.

Publish committed facts after successful persistence. When a committed write and eventual publication must both be guaranteed, use an appropriate transactional outbox or equivalent durable mechanism. Define retry, idempotency, duplicate handling, ordering, and failed-message recovery only to the extent required. Do not promise exactly-once delivery merely because a broker is present.

### Wrapping and shared state

Define decorator order explicitly. Verify authorization cannot be bypassed by cached results; include tenant/user scope in cache keys where required. Define cache invalidation and avoid logging secrets. Propagate cancellation and errors correctly. Do not assume language annotation/decorator syntax implements the structural Decorator pattern.

For shared resources, verify concurrency safety, lifecycle cleanup, and shutdown. Keep transaction/session objects scoped appropriately. Prefer explicit dependencies over global accessors.

### Resilience

Define closed, open, and half-open behavior. Specify failure classification, rolling window/minimum sample, opening threshold, cooldown, and bounded probes based on requirements or measured behavior. Label any initial values as provisional and tunable.

Combine breakers with request timeouts and a bounded overall deadline. Avoid layered retry multiplication. Retry side effects only with appropriate idempotency guarantees. Do not count ordinary input/authentication failures as dependency outages by default. Return honest failure states; never turn a failed payment into apparent success. Emit metrics for failures, timeouts, transitions, and fallback use.

### CQRS and projections

Try query/index tuning and caching where relevant before adding separate infrastructure. If separate projections are selected, specify source of truth, freshness expectations, read-after-write behavior, replay/rebuild, and reconciliation. Expose stale/pending states honestly. Retain a simpler shared-store design when eventual consistency is unacceptable or operational support is insufficient.

## Verification

Run checks appropriate to the actual change. Validate behavior at the boundary affected, not just the existence of new classes.

- Repository/adapter: verify mapping, error propagation, transaction behavior, and relevant integration contracts; mocks alone cannot prove real database/provider behavior.
- Factory/strategy/builder: verify selection, unsupported configuration, representative rule boundaries, and construction invariants.
- Singleton/decorator: verify state isolation, ordering, concurrency where applicable, and cleanup.
- Observer/CQRS: verify commit failure, duplicate delivery, handler failure, and freshness/recovery where those semantics apply.
- Circuit breaker: verify opening, fast failure, bounded half-open probes, recovery, fallback correctness, and retry budget using controlled failures/time.

For advice-only tasks, explain proposed verification without claiming tests ran. For code changes, report actual commands/results and remaining gaps. Avoid introducing a large test framework for a small reversible change.

## Decision response

Keep routine reports short. Use this structure when helpful:

- **Decision:** pattern(s), framework mechanism, or no new abstraction.
- **Evidence:** requirement or concrete code location and the problem it demonstrates.
- **Implementation:** smallest boundary/change and preserved behavior.
- **Tradeoff:** added complexity, rejected alternative, and reconsideration trigger.
- **Verification:** checks performed and gaps.
- **Confidence:** high/medium/low with a reason; distinguish assumptions from observed facts.

Use current official documentation when relying on version-specific library behavior. Do not invent package APIs, benchmark results, or evidence of performance improvements.

## Calibration examples

- Small CRUD service with clean ORM usage and no measured bottleneck: keep CRUD; do not add repositories or CQRS automatically.
- Three payment SDKs created across controllers with inconsistent responses: use adapters plus centralized construction; add strategy only if business algorithms vary separately.
- Growing premium/student/promotion pricing branches: use strategies if rules evolve independently; explicitly resolve precedence or composition when multiple discounts apply.
- Notification/analytics reactions after an order commit: consider observers; require durable delivery only if loss is unacceptable; keep mandatory stock/payment invariants explicit.
- User profile with ten optional fields in a language with named parameters: prefer a validated options/data object before introducing a builder.
- Slow shipping API exhausting workers: enforce timeout/deadline, assess bounded retries and breaker, and return a clear unavailable/pending result.
- Many profile reads with slow SQL: inspect query plans and indexes before recommending CQRS or a second database.

## Source basis

Derive the ten-pattern vocabulary and problem-first principles from the user-provided backend design patterns transcript from video https://www.youtube.com/watch?v=b4IlyJSIlL0 . Treat the decision gates, implementation safeguards, and verification workflow as operational refinements added to make those principles actionable. Do not present the transcript's future-looking framing as a requirement to adopt any pattern.
