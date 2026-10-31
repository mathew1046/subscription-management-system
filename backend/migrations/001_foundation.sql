CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE CHECK(email=lower(trim(email))),
 name text NOT NULL, password_hash text NOT NULL, role text NOT NULL DEFAULT 'customer' CHECK(role IN ('admin','staff','customer')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE password_resets (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL);
CREATE TABLE rate_limits (key text PRIMARY KEY, hits integer NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE REFERENCES users(id), name text NOT NULL, email text NOT NULL, address text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, type text NOT NULL, sale_price numeric(16,2) NOT NULL CHECK(sale_price>=0), cost_price numeric(16,2) NOT NULL CHECK(cost_price>=0), notes text NOT NULL DEFAULT '', archived boolean NOT NULL DEFAULT false);
CREATE TABLE variants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL REFERENCES products(id), name text NOT NULL, price_delta numeric(16,2) NOT NULL DEFAULT 0, UNIQUE(product_id,name));
CREATE TABLE plans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, price numeric(16,2) NOT NULL CHECK(price>=0), cadence text NOT NULL CHECK(cadence IN ('daily','weekly','monthly','yearly')), min_quantity integer NOT NULL CHECK(min_quantity>0), available_from date NOT NULL, available_until date, auto_close boolean NOT NULL DEFAULT true, allow_close boolean NOT NULL DEFAULT true, allow_pause boolean NOT NULL DEFAULT false, allow_renew boolean NOT NULL DEFAULT true, CHECK(available_until IS NULL OR available_until>=available_from));
CREATE TABLE taxes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, rate numeric(7,4) NOT NULL CHECK(rate>=0 AND rate<=100));
CREATE TABLE discounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, kind text NOT NULL CHECK(kind IN ('fixed','percentage')), value numeric(16,2) NOT NULL CHECK(value>=0), min_purchase numeric(16,2) NOT NULL DEFAULT 0 CHECK(min_purchase>=0), min_quantity integer NOT NULL DEFAULT 1 CHECK(min_quantity>0), starts_on date NOT NULL, ends_on date NOT NULL, max_uses integer NOT NULL CHECK(max_uses>0), uses integer NOT NULL DEFAULT 0 CHECK(uses>=0 AND uses<=max_uses), product_id uuid REFERENCES products(id), CHECK(ends_on>=starts_on), CHECK(kind<>'percentage' OR value<=100));
CREATE TABLE quotation_templates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, plan_id uuid NOT NULL REFERENCES plans(id), valid_days integer NOT NULL CHECK(valid_days>0), lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array'));
CREATE SEQUENCE subscription_number;
CREATE TABLE subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), number text NOT NULL UNIQUE DEFAULT ('SUB-'||lpad(nextval('subscription_number')::text,8,'0')),
 customer_id uuid NOT NULL REFERENCES customers(id), plan_id uuid NOT NULL REFERENCES plans(id),
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft','Quotation','Confirmed','Active','Closed')),
 start_date date NOT NULL, end_date date NOT NULL, quote_valid_until date NOT NULL, payment_terms_days integer NOT NULL DEFAULT 14 CHECK(payment_terms_days BETWEEN 0 AND 365),
 next_billing_date date NOT NULL, anchor_day integer NOT NULL CHECK(anchor_day BETWEEN 1 AND 31), paused boolean NOT NULL DEFAULT false,
 close_reason text CHECK(close_reason IN ('cancelled','expired')), billing_error text, retry_after timestamptz,
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'), created_at timestamptz NOT NULL DEFAULT now(), CHECK(end_date>start_date)
);
CREATE TABLE subscription_lines (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subscription_id uuid NOT NULL REFERENCES subscriptions(id), product_id uuid NOT NULL REFERENCES products(id), variant_id uuid REFERENCES variants(id), description text NOT NULL, quantity integer NOT NULL CHECK(quantity>0), unit_price numeric(16,2) NOT NULL CHECK(unit_price>=0), tax_rate numeric(7,4) NOT NULL CHECK(tax_rate BETWEEN 0 AND 100));
CREATE SEQUENCE invoice_number;
CREATE TABLE invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), number text NOT NULL UNIQUE DEFAULT ('INV-'||lpad(nextval('invoice_number')::text,8,'0')),
 subscription_id uuid NOT NULL REFERENCES subscriptions(id), customer_id uuid NOT NULL REFERENCES customers(id), customer_snapshot jsonb NOT NULL,
 period_start date NOT NULL, period_end date NOT NULL, issued_on date NOT NULL, due_on date NOT NULL,
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft','Confirmed','Paid','Cancelled')),
 currency text NOT NULL, subtotal numeric(16,2) NOT NULL CHECK(subtotal>=0), discount_total numeric(16,2) NOT NULL CHECK(discount_total>=0), tax_total numeric(16,2) NOT NULL CHECK(tax_total>=0), total numeric(16,2) NOT NULL CHECK(total>=0), discount_id uuid REFERENCES discounts(id), discount_snapshot jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(period_end>period_start), CHECK(due_on>=issued_on), CHECK(total=subtotal-discount_total+tax_total), UNIQUE(subscription_id,period_start), UNIQUE(subscription_id,period_start,period_end)
);
CREATE TABLE invoice_lines (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id uuid NOT NULL REFERENCES invoices(id), description text NOT NULL, quantity integer NOT NULL, unit_price numeric(16,2) NOT NULL, discount_amount numeric(16,2) NOT NULL, tax_rate numeric(7,4) NOT NULL, tax_amount numeric(16,2) NOT NULL, total numeric(16,2) NOT NULL);
CREATE TABLE payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id uuid NOT NULL REFERENCES invoices(id), amount numeric(16,2) NOT NULL CHECK(amount>0), method text NOT NULL, paid_on date NOT NULL, note text NOT NULL DEFAULT '', request_key uuid NOT NULL UNIQUE, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE audit_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid REFERENCES users(id), action text NOT NULL, resource_id uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE outbox (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient text NOT NULL, subject text NOT NULL, body text NOT NULL, attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, last_error text);
CREATE INDEX subscriptions_customer ON subscriptions(customer_id,created_at DESC);
CREATE INDEX subscriptions_due ON subscriptions(next_billing_date) WHERE status='Active' AND paused=false;
CREATE INDEX invoices_customer ON invoices(customer_id,created_at DESC);
CREATE INDEX invoices_due ON invoices(due_on) WHERE status='Confirmed';
CREATE INDEX payments_invoice ON payments(invoice_id);
CREATE INDEX payments_date ON payments(paid_on);
CREATE INDEX outbox_pending ON outbox(available_at) WHERE sent_at IS NULL;
-- PostgreSQL is private to the server. No browser/database or public REST access.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
ALTER TABLE subscriptions ADD COLUMN plan_snapshot jsonb NOT NULL;
ALTER TABLE outbox ADD COLUMN invoice_id uuid REFERENCES invoices(id);
CREATE UNIQUE INDEX outbox_invoice_unique ON outbox(invoice_id) WHERE invoice_id IS NOT NULL;
