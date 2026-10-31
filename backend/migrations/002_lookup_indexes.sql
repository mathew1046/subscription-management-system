-- Bound child-record lookups as subscription and invoice history grows.
CREATE INDEX subscription_lines_subscription ON subscription_lines(subscription_id, id);
CREATE INDEX invoice_lines_invoice ON invoice_lines(invoice_id, id);
CREATE INDEX password_resets_expiry ON password_resets(expires_at);
CREATE INDEX password_resets_user ON password_resets(user_id);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX rate_limits_expiry ON rate_limits(expires_at);
CREATE INDEX invoices_issued ON invoices(issued_on, customer_id) WHERE status IN ('Confirmed', 'Paid');
CREATE INDEX subscriptions_created ON subscriptions(created_at DESC, id DESC);
CREATE INDEX invoices_created ON invoices(created_at DESC, id DESC);
