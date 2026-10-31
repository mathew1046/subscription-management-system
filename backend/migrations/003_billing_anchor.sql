-- Keep the entire recurrence anchor when a shortened final period is renewed.
ALTER TABLE subscriptions ADD COLUMN billing_anchor date;
UPDATE subscriptions SET billing_anchor = start_date;
ALTER TABLE subscriptions ALTER COLUMN billing_anchor SET NOT NULL;
ALTER TABLE variants ADD CONSTRAINT variants_nonnegative_delta CHECK(price_delta >= 0);
