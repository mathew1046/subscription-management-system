package app

import (
	"context"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
)

const invoiceSelect = `SELECT i.*,COALESCE(p.paid,0)::numeric(16,2) AS paid,(CASE WHEN i.status='Cancelled' THEN 0 ELSE i.total-COALESCE(p.paid,0) END)::numeric(16,2) AS balance FROM invoices i LEFT JOIN LATERAL (SELECT SUM(amount) AS paid FROM payments WHERE invoice_id=i.id) p ON true JOIN customers c ON c.id=i.customer_id `

func invoiceEmail(ctx context.Context, q Querier, id string) Object {
	items := rows(ctx, q, `SELECT CASE WHEN sent_at IS NOT NULL THEN 'sent' WHEN attempts>=8 THEN 'failed' WHEN last_error IS NOT NULL THEN 'retrying' ELSE 'queued' END AS status,attempts,sent_at,last_error FROM outbox WHERE invoice_id=$1`, id)
	if len(items) == 0 {
		return Object{"status": "not_queued", "attempts": 0, "sent_at": nil, "last_error": nil}
	}
	return items[0]
}

func (a *App) invoices(w http.ResponseWriter, r *http.Request) any {
	u := a.user(r)
	ctx := r.Context()
	recordID := r.PathValue("id")
	if recordID != "" {
		validID(recordID)
		return a.tx(ctx, func(tx pgx.Tx) any {
			// Payment and status writers lock this row; hold a shared lock across all reads.
			one(ctx, tx, "SELECT i.id FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.id=$1 AND ($2::text<>'customer' OR c.user_id=$3) FOR SHARE OF i", recordID, u.Role, u.ID)
			i := one(ctx, tx, invoiceSelect+"WHERE i.id=$1 AND ($2::text<>'customer' OR c.user_id=$3)", recordID, u.Role, u.ID)
			i["lines"] = rows(ctx, tx, "SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY id", recordID)
			i["payments"] = rows(ctx, tx, "SELECT * FROM payments WHERE invoice_id=$1 ORDER BY paid_on,id", recordID)
			if u.Role != "customer" {
				i["email"] = invoiceEmail(ctx, tx, recordID)
			}
			return i
		})
	}
	page, size := pagination(r)
	status := r.URL.Query().Get("status")
	switch status {
	case "", "Draft", "Confirmed", "Paid", "Cancelled", "Outstanding", "Overdue":
	default:
		panic(fault{400, "VALIDATION", "Invalid invoice status."})
	}
	customer := r.URL.Query().Get("customer_id")
	if customer != "" {
		validID(customer)
		customer = strings.ToLower(customer)
	}
	from, to := r.URL.Query().Get("from"), r.URL.Query().Get("to")
	if from != "" {
		parseDate(from)
	}
	if to != "" {
		parseDate(to)
	}
	require(from == "" || to == "" || from <= to, 400, "VALIDATION", "Invalid invoice dates.")
	return paged(rows(ctx, a.DB, invoiceSelect+`WHERE ($1::text<>'customer' OR c.user_id=$2) AND ($3='' OR i.status=$3 OR ($3 IN ('Outstanding','Overdue') AND i.status='Confirmed' AND i.total>COALESCE(p.paid,0) AND ($3='Outstanding' OR i.due_on<(now() AT TIME ZONE 'UTC')::date))) AND ($4='' OR i.customer_id::text=$4) AND ($5='' OR i.issued_on>=NULLIF($5,'')::date) AND ($6='' OR i.issued_on<=NULLIF($6,'')::date) ORDER BY i.created_at DESC,i.id LIMIT $7 OFFSET $8`, u.Role, u.ID, status, customer, from, to, size+1, (page-1)*size), page, size)
}
func (a *App) invoiceAction(w http.ResponseWriter, r *http.Request) any {
	u := a.user(r)
	internal(u)
	ctx := r.Context()
	recordID, action := r.PathValue("id"), r.PathValue("action")
	return a.tx(ctx, func(tx pgx.Tx) any {
		i := owned(ctx, tx, "invoices", recordID, u, true)
		switch action {
		case "confirm":
			require(i["status"] == "Draft", 409, "INVALID_TRANSITION", "Only draft invoices can be confirmed.")
			state := "Confirmed"
			if number(i["total"]).IsZero() {
				state = "Paid"
			}
			exec(ctx, tx, "UPDATE invoices SET status=$1 WHERE id=$2", state, recordID)
		case "cancel":
			require(i["status"] == "Draft" || i["status"] == "Confirmed", 409, "INVALID_TRANSITION", "Invoice cannot be cancelled.")
			p := one(ctx, tx, "SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE invoice_id=$1", recordID)
			require(number(p["paid"]).IsZero(), 409, "PAYMENTS_EXIST", "Cannot cancel an invoice with payments.")
			// Serialize with delivery so a still-pending email is not sent after cancellation.
			exec(ctx, tx, "DELETE FROM outbox WHERE invoice_id=$1 AND sent_at IS NULL", recordID)
			exec(ctx, tx, "UPDATE invoices SET status='Cancelled' WHERE id=$1", recordID)
		case "send":
			require(i["status"] == "Confirmed" || i["status"] == "Paid", 409, "INVALID_TRANSITION", "Confirm the invoice before sending.")
			customer := i["customer_snapshot"].(map[string]any)
			exec(ctx, tx, `INSERT INTO outbox(invoice_id,recipient,subject,body) VALUES($1,$2,$3,$4) ON CONFLICT(invoice_id) WHERE invoice_id IS NOT NULL DO NOTHING`, recordID, customer["email"], "Brightloop invoice "+str(i["number"]), "Invoice "+str(i["number"])+"\nTotal: "+str(i["currency"])+" "+str(i["total"])+"\nDue: "+str(i["due_on"])+"\nView and print: "+a.Origin+"/portal/invoices/"+recordID)
			audit(ctx, tx, u, "invoice.send", recordID)
			return Object{"ok": true, "email": invoiceEmail(ctx, tx, recordID)}
		default:
			panic(fault{404, "NOT_FOUND", "Unknown invoice action."})
		}
		audit(ctx, tx, u, "invoice."+action, recordID)
		return Object{"ok": true}
	})
}

type PaymentInput struct {
	InvoiceID  string `json:"invoice_id"`
	Amount     string `json:"amount"`
	Method     string `json:"method"`
	PaidOn     string `json:"paid_on"`
	Note       string `json:"note"`
	RequestKey string `json:"request_key"`
}

func validatePayment(v PaymentInput, now string) PaymentInput {
	validID(v.InvoiceID)
	validID(v.RequestKey)
	v.InvoiceID = strings.ToLower(v.InvoiceID)
	v.RequestKey = strings.ToLower(v.RequestKey)
	money(v.Amount)
	require(number(v.Amount).IsPositive(), 400, "VALIDATION", "Amount must be positive.")
	parseDate(v.PaidOn)
	require(v.PaidOn <= now && len(v.Note) <= 2000, 400, "VALIDATION", "Invalid payment date or note.")
	switch v.Method {
	case "bank_transfer", "cash", "card", "upi", "other":
	default:
		panic(fault{400, "VALIDATION", "Invalid payment method."})
	}
	return v
}

func paymentMatches(p Object, v PaymentInput) bool {
	return p["invoice_id"] == v.InvoiceID && number(p["amount"]).Equal(number(v.Amount)) && p["method"] == v.Method && p["paid_on"] == v.PaidOn && p["note"] == v.Note
}

func (a *App) payment(w http.ResponseWriter, r *http.Request) any {
	u := a.user(r)
	internal(u)
	v := validatePayment(body[PaymentInput](w, r), today())
	ctx := r.Context()
	return a.tx(ctx, func(tx pgx.Tx) any {
		// Serialize a key across invoices before taking any invoice lock. Hash collisions
		// only serialize unrelated keys; PostgreSQL uniqueness remains authoritative.
		exec(ctx, tx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", v.RequestKey)
		i := owned(ctx, tx, "invoices", v.InvoiceID, u, true)
		existing := rows(ctx, tx, "SELECT * FROM payments WHERE request_key=$1", v.RequestKey)
		if len(existing) > 0 {
			p := existing[0]
			require(paymentMatches(p, v), 409, "IDEMPOTENCY_MISMATCH", "Request key already used for different payment data.")
			return p
		}
		require(i["status"] == "Confirmed", 409, "INVALID_TRANSITION", "Payments require a confirmed invoice.")
		paid := one(ctx, tx, "SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE invoice_id=$1", v.InvoiceID)
		balance := number(i["total"]).Sub(number(paid["paid"]))
		amount := number(v.Amount)
		require(amount.LessThanOrEqual(balance), 400, "OVERPAYMENT", "Payment exceeds outstanding balance.")
		p := one(ctx, tx, "INSERT INTO payments(invoice_id,amount,method,paid_on,note,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *", v.InvoiceID, v.Amount, v.Method, v.PaidOn, v.Note, v.RequestKey, u.ID)
		if amount.Equal(balance) {
			exec(ctx, tx, "UPDATE invoices SET status='Paid' WHERE id=$1", v.InvoiceID)
		}
		audit(ctx, tx, u, "payment.record", str(p["id"]))
		return p
	})
}
func reportFilters(r *http.Request, now string) (from, to, customer string, includePayments bool) {
	from, to = r.URL.Query().Get("from"), r.URL.Query().Get("to")
	if from == "" {
		from = now[:8] + "01"
	}
	if to == "" {
		to = now
	}
	parseDate(from)
	parseDate(to)
	require(from <= to, 400, "VALIDATION", "Invalid report dates.")
	customer = r.URL.Query().Get("customer_id")
	if customer != "" {
		validID(customer)
		customer = strings.ToLower(customer)
	}
	include := r.URL.Query().Get("include_payments")
	require(include == "" || include == "true" || include == "false", 400, "VALIDATION", "Invalid include_payments value.")
	return from, to, customer, include == "true"
}

func (a *App) report(w http.ResponseWriter, r *http.Request) any {
	u := a.user(r)
	internal(u)
	now := today()
	from, to, customer, includePayments := reportFilters(r, now)
	page, size := 1, 25
	if includePayments {
		page, size = pagination(r)
	}
	ctx := r.Context()
	return a.tx(ctx, func(tx pgx.Tx) any {
		// The summary and optional payment page must describe the same committed snapshot.
		exec(ctx, tx, "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
		result := one(ctx, tx, `WITH selected AS (
		SELECT i.*,COALESCE(p.paid,0) AS paid FROM invoices i
		LEFT JOIN LATERAL(SELECT SUM(amount) paid FROM payments WHERE invoice_id=i.id) p ON true
		WHERE ($3='' OR i.customer_id::text=$3) AND i.currency=$4
	), cash AS (
		SELECT COALESCE(SUM(p.amount),0) total FROM payments p JOIN invoices i ON i.id=p.invoice_id
		WHERE p.paid_on BETWEEN $1::date AND $2::date AND ($3='' OR i.customer_id::text=$3) AND i.currency=$4
	)
	SELECT (SELECT COUNT(*)::integer FROM subscriptions
		WHERE status='Active' AND paused=false AND start_date<=$5::date AND end_date>$5::date
		AND ($3='' OR customer_id::text=$3) AND currency=$4) AS active_subscriptions,
		ROUND(COALESCE(SUM(total) FILTER(WHERE status IN ('Confirmed','Paid') AND issued_on BETWEEN $1::date AND $2::date),0),2) billed,
		ROUND((SELECT total FROM cash),2) collected,
		ROUND(COALESCE(SUM(total-paid) FILTER(WHERE status='Confirmed'),0),2) outstanding,
		ROUND(COALESCE(SUM(total-paid) FILTER(WHERE status='Confirmed' AND due_on<$5::date),0),2) overdue
	FROM selected`, from, to, customer, a.Currency, now)
		result["currency"] = a.Currency
		result["from"] = from
		result["to"] = to
		if includePayments {
			// Match collected's payment-date/customer/currency filters, not invoice issue dates.
			result["payments"] = paged(rows(ctx, tx, `SELECT p.*,i.number AS invoice_number,i.customer_id,i.customer_snapshot->>'name' AS customer_name,i.currency
				FROM payments p JOIN invoices i ON i.id=p.invoice_id
				WHERE p.paid_on BETWEEN $1::date AND $2::date AND ($3='' OR i.customer_id::text=$3) AND i.currency=$4
				ORDER BY p.paid_on DESC,p.id LIMIT $5 OFFSET $6`, from, to, customer, a.Currency, size+1, (page-1)*size), page, size)
		}
		return result
	})
}
