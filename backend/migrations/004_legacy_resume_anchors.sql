-- Migration 003 backfilled start_date, but pre-003 resumes could reset the
-- recurrence. Recover the last effective resume from its transactional audit
-- record, not the cursor: a final shortened invoice can move that cursor off
-- cadence. An invoice already covering the resume date means prepaid coverage
-- was preserved and that resume did not change the anchor.
WITH legacy_resumes AS (
 SELECT s.id, s.billing_anchor, s.anchor_day, s.plan_snapshot->>'cadence' AS cadence,
  (
   SELECT (e.created_at AT TIME ZONE 'UTC')::date
   FROM audit_events e
   WHERE e.resource_id = s.id AND e.action = 'subscription.resume'
    AND e.created_at < migration.applied_at
    AND (e.created_at AT TIME ZONE 'UTC')::date BETWEEN s.start_date AND s.next_billing_date
    AND NOT EXISTS (
     SELECT 1 FROM invoices i
     WHERE i.subscription_id = s.id AND i.created_at <= e.created_at
      AND i.period_start <= (e.created_at AT TIME ZONE 'UTC')::date
      AND i.period_end > (e.created_at AT TIME ZONE 'UTC')::date
    )
   ORDER BY e.created_at DESC, e.id DESC LIMIT 1
  ) AS resumed_on
 FROM subscriptions s
 JOIN schema_migrations migration ON migration.name = '003_billing_anchor.sql'
 WHERE s.created_at < migration.applied_at AND s.billing_anchor = s.start_date
  AND s.plan_snapshot->>'cadence' IN ('weekly', 'monthly', 'yearly')
)
UPDATE subscriptions s SET billing_anchor = r.resumed_on
FROM legacy_resumes r
WHERE s.id = r.id AND s.billing_anchor = r.billing_anchor AND s.anchor_day = r.anchor_day
 -- Retain anchor_day (including 31) and both financial/plan snapshots. New or
 -- already-correct anchors are untouched, including cadence-equivalent dates.
 AND EXTRACT(DAY FROM r.resumed_on) = r.anchor_day
 AND CASE r.cadence
  WHEN 'weekly' THEN (r.resumed_on - r.billing_anchor) % 7 <> 0
  WHEN 'monthly' THEN EXTRACT(DAY FROM r.resumed_on) <> EXTRACT(DAY FROM r.billing_anchor)
  WHEN 'yearly' THEN EXTRACT(MONTH FROM r.resumed_on) <> EXTRACT(MONTH FROM r.billing_anchor)
   OR EXTRACT(DAY FROM r.resumed_on) <> EXTRACT(DAY FROM r.billing_anchor)
  ELSE false
 END;
