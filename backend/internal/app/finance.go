package app

import (
	"github.com/jackc/pgx/v5"
	"net/http"
	"strings"
)

const invoiceSelect = `SELECT i.*,COALESCE(p.paid,0)::numeric(16,2) AS paid,(i.total-COALESCE(p.paid,0))::numeric(16,2) AS balance FROM invoices i LEFT JOIN LATERAL (SELECT SUM(amount) AS paid FROM payments WHERE invoice_id=i.id) p ON true JOIN customers c ON c.id=i.customer_id `

func (a *App) invoices(w http.ResponseWriter, r *http.Request) any {
	u := a.user(r)
	ctx := r.Context()
	recordID := r.PathValue("id")
	if recordID != "" {
		validID(recordID)
		return a.tx(ctx, func(tx pgx.Tx) any {
			i := one(ctx, tx, invoiceSelect+"WHERE i.id=$1 AND ($2::text<>'customer' OR c.user_id=$3)", recordID, u.Role, u.ID)
			i["lines"] = rows(ctx, tx, "SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY id", recordID)
			i["payments"] = rows(ctx, tx, "SELECT * FROM payments WHERE invoice_id=$1 ORDER BY paid_on,id", recordID)
			return i
		})
	}
	page, size := pagination(r)
	status := r.URL.Query().Get("status")
	customer := r.URL.Query().Get("customer_id")
	if customer != "" {
		validID(customer)
	}
	from, to := r.URL.Query().Get("from"), r.URL.Query().Get("to")
	if from != "" {
		parseDate(from)
	}
	if to != "" {
		parseDate(to)
	}
	return paged(rows(ctx, a.DB, invoiceSelect+`WHERE ($1::text<>'customer' OR c.user_id=$2) AND ($3='' OR i.status=$3 OR ($3='Overdue' AND i.status='Confirmed' AND i.due_on<CURRENT_DATE)) AND ($4='' OR i.customer_id::text=$4) AND ($5='' OR i.issued_on>=NULLIF($5,'')::date) AND ($6='' OR i.issued_on<=NULLIF($6,'')::date) ORDER BY i.created_at DESC,i.id LIMIT $7 OFFSET $8`, u.Role, u.ID, status, customer, from, to, size+1, (page-1)*size), page, size)
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
			exec(ctx, tx, "UPDATE invoices SET status='Cancelled' WHERE id=$1", recordID)
		case "send":
			require(i["status"] == "Confirmed" || i["status"] == "Paid", 409, "INVALID_TRANSITION", "Confirm the invoice before sending.")
			customer := i["customer_snapshot"].(map[string]any)
			exec(ctx, tx, `INSERT INTO outbox(invoice_id,recipient,subject,body) VALUES($1,$2,$3,$4) ON CONFLICT(invoice_id) WHERE invoice_id IS NOT NULL DO NOTHING`, recordID, customer["email"], "Brightloop invoice "+str(i["number"]), "Invoice "+str(i["number"])+"\nTotal: "+str(i["currency"])+" "+str(i["total"])+"\nDue: "+str(i["due_on"])+"\nView and print: "+a.Origin+"/portal/invoices/"+recordID)
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

func (a *App) payment(w http.ResponseWriter, r *http.Request) any {
	u := a.user(r)
	internal(u)
	v := body[PaymentInput](w, r)
	validID(v.InvoiceID)
	validID(v.RequestKey)
	money(v.Amount)
	require(number(v.Amount).IsPositive(), 400, "VALIDATION", "Amount must be positive.")
	parseDate(v.PaidOn)
	require(v.PaidOn <= today() && len(v.Note) <= 2000, 400, "VALIDATION", "Invalid payment date or note.")
	require(strings.Contains("|bank_transfer|cash|card|upi|other|", "|"+v.Method+"|"), 400, "VALIDATION", "Invalid payment method.")
	ctx := r.Context()
	return a.tx(ctx, func(tx pgx.Tx) any {
		i := owned(ctx, tx, "invoices", v.InvoiceID, u, true)
		existing := rows(ctx, tx, "SELECT * FROM payments WHERE request_key=$1", v.RequestKey)
		if len(existing) > 0 {
			p := existing[0]
			require(p["invoice_id"] == v.InvoiceID && number(p["amount"]).Equal(number(v.Amount)) && p["method"] == v.Method && p["paid_on"] == v.PaidOn && p["note"] == v.Note, 409, "IDEMPOTENCY_MISMATCH", "Request key already used for different payment data.")
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
func (a *App) report(w http.ResponseWriter, r *http.Request) any {
	u := a.user(r)
	internal(u)
	from, to := r.URL.Query().Get("from"), r.URL.Query().Get("to")
	if from == "" {
		from = today()[:8] + "01"
	}
	if to == "" {
		to = today()
	}
	parseDate(from)
	parseDate(to)
	require(from <= to, 400, "VALIDATION", "Invalid report dates.")
	customer := r.URL.Query().Get("customer_id")
	if customer != "" {
		validID(customer)
	}
	ctx := r.Context()
	result := one(ctx, a.DB, `WITH selected AS (SELECT i.*,COALESCE(p.paid,0) AS paid FROM invoices i LEFT JOIN LATERAL(SELECT SUM(amount) paid FROM payments WHERE invoice_id=i.id) p ON true WHERE ($3='' OR i.customer_id::text=$3) AND i.currency=$4), cash AS (SELECT COALESCE(SUM(p.amount),0) total FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.paid_on BETWEEN $1::date AND $2::date AND ($3='' OR i.customer_id::text=$3) AND i.currency=$4) SELECT (SELECT COUNT(*)::integer FROM subscriptions WHERE status='Active' AND paused=false AND start_date<=CURRENT_DATE AND end_date>CURRENT_DATE AND ($3='' OR customer_id::text=$3)) AS active_subscriptions,COALESCE(SUM(total) FILTER(WHERE status IN ('Confirmed','Paid') AND issued_on BETWEEN $1::date AND $2::date),0)::numeric(16,2) billed,(SELECT total FROM cash)::numeric(16,2) collected,COALESCE(SUM(total-paid) FILTER(WHERE status='Confirmed'),0)::numeric(16,2) outstanding,COALESCE(SUM(total-paid) FILTER(WHERE status='Confirmed' AND due_on<CURRENT_DATE),0)::numeric(16,2) overdue FROM selected`, from, to, customer, a.Currency)
	result["currency"] = a.Currency
	result["from"] = from
	result["to"] = to
	return result
}
