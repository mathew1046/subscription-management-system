-- Reservations, subscriptions, lines and audit events commit atomically. The
-- deferred FK lets creation reserve the actor/key before reading the catalog.
-- The application inserts these canonical payloads once; it never rewrites them.
CREATE TABLE subscription_create_requests (
 actor_id uuid NOT NULL REFERENCES users(id),
 request_key uuid NOT NULL,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 subscription_id uuid NOT NULL UNIQUE REFERENCES subscriptions(id) DEFERRABLE INITIALLY DEFERRED,
 PRIMARY KEY(actor_id,request_key)
);
REVOKE ALL ON subscription_create_requests FROM PUBLIC;
