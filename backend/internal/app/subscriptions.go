package app

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type LineInput struct {
	ProductID string  `json:"product_id"`
	VariantID *string `json:"variant_id"`
	Quantity  int     `json:"quantity"`
	TaxID     *string `json:"tax_id"`
}
type SubscriptionInput struct {
	RequestKey *string     `json:"request_key,omitempty"`
	CustomerID string      `json:"customer_id"`
	PlanID     string      `json:"plan_id"`
	Start      string      `json:"start_date"`
	End        string      `json:"end_date"`
	QuoteUntil string      `json:"quote_valid_until"`
	Terms      *int        `json:"payment_terms_days"`
	Lines      []LineInput `json:"lines"`
}

// Only explicitly keyed subscription creation may restart a failed transaction.
// A unique-key loser can have a snapshot predating the winner, so it must begin
// a new transaction before looking up the committed reservation. Never retry an
// ambiguous commit/network failure or an unkeyed, non-idempotent creation.
func (a *App) subscriptionCreationTx(ctx context.Context, keyed bool, fn func(pgx.Tx) any) any {
	for attempt := 0; ; attempt++ {
		var result, failure any
		func() {
			defer func() { failure = recover() }()
			result = a.tx(ctx, fn)
		}()
		if failure == nil {
			return result
		}
		e, ok := failure.(*pgconn.PgError)
		retryable := ok && (e.Code == "40001" || (e.Code == "23505" && e.ConstraintName == "subscription_create_requests_pkey"))
		if !keyed || attempt >= 2 || !retryable {
			panic(failure)
		}
		check(ctx.Err())
	}
}

type LifecycleInput struct {
	Action string `json:"action"`
	End    string `json:"end_date"`
}

func validateLines(lines []LineInput) {
	require(len(lines) > 0 && len(lines) <= 100, 400, "VALIDATION", "Use 1 to 100 product lines.")
	for _, l := range lines {
		validID(l.ProductID)
		if l.VariantID != nil {
			validID(*l.VariantID)
		}
		if l.TaxID != nil {
			validID(*l.TaxID)
		}
		require(l.Quantity > 0 && l.Quantity <= 100000, 400, "VALIDATION", "Invalid line quantity.")
	}
}
func resolveLine(ctx context.Context, q Querier, l LineInput) Object {
	p := one(ctx, q, "SELECT * FROM products WHERE id=$1 AND archived=false FOR SHARE", l.ProductID)
	price := number(p["sale_price"])
	description := str(p["name"])
	if l.VariantID != nil {
		v := one(ctx, q, "SELECT * FROM variants WHERE id=$1 AND product_id=$2 FOR SHARE", *l.VariantID, l.ProductID)
		price = price.Add(number(v["price_delta"]))
		description += " / " + str(v["name"])
	}
	rate := "0"
	if l.TaxID != nil {
		t := one(ctx, q, "SELECT * FROM taxes WHERE id=$1 FOR SHARE", *l.TaxID)
		rate = str(t["rate"])
	}
	return Object{"description": description, "unit_price": price.StringFixed(2), "tax_rate": rate}
}
func owned(ctx context.Context, q Querier, table, id string, u User, lock bool) Object {
	validID(id)
	sql := "SELECT r.* FROM " + table + " r JOIN customers c ON c.id=r.customer_id WHERE r.id=$1 AND ($2::text<>'customer' OR c.user_id=$3)"
	if lock {
		sql += " FOR UPDATE OF r"
	}
	return one(ctx, q, sql, id, u.Role, u.ID)
}
func (a *App) subscriptions(w http.ResponseWriter, r *http.Request) any {
	u := a.user(r)
	ctx := r.Context()
	recordID := r.PathValue("id")
	if r.Method == "GET" {
		if recordID != "" {
			return a.tx(ctx, func(tx pgx.Tx) any {
				s := owned(ctx, tx, "subscriptions", recordID, u, false)
				lines := rows(ctx, tx, "SELECT * FROM subscription_lines WHERE subscription_id=$1 ORDER BY id", recordID)
				priced := make([]pricedLine, 0, len(lines)+1)
				for _, line := range lines {
					priced = append(priced, pricedLine{Quantity: integer(line["quantity"]), Unit: number(line["unit_price"]), Tax: number(line["tax_rate"])})
				}
				plan := s["plan_snapshot"].(map[string]any)
				priced = append(priced, pricedLine{Quantity: 1, Unit: number(plan["price"]), Tax: number("0")})
				computed, subtotal, _, tax, total := calculate(priced, nil)
				for n, line := range lines {
					line["subtotal"] = computed[n].Base.StringFixed(2)
					line["tax_amount"] = computed[n].TaxAmount.StringFixed(2)
					line["total"] = computed[n].Total.StringFixed(2)
				}
				s["lines"] = lines
				s["quote_totals"] = Object{"subtotal": subtotal.StringFixed(2), "tax_total": tax.StringFixed(2), "total": total.StringFixed(2)}
				return s
			})
		}
		page, size := pagination(r)
		customer := r.URL.Query().Get("customer_id")
		if customer != "" {
			validID(customer)
			customer = strings.ToLower(customer)
		}
		status := r.URL.Query().Get("status")
		switch status {
		case "", "Draft", "Quotation", "Confirmed", "Active", "Closed":
		default:
			panic(fault{400, "VALIDATION", "Invalid subscription status."})
		}
		return paged(rows(ctx, a.DB, `SELECT s.* FROM subscriptions s JOIN customers c ON c.id=s.customer_id WHERE ($1::text<>'customer' OR c.user_id=$2) AND ($3='' OR s.status=$3) AND ($4='' OR s.customer_id::text=$4) ORDER BY s.created_at DESC,s.id LIMIT $5 OFFSET $6`, u.Role, u.ID, status, customer, size+1, (page-1)*size), page, size)
	}
	internal(u)
	v := body[SubscriptionInput](w, r)
	terms := 14
	if v.Terms != nil {
		terms = *v.Terms
	}
	validID(v.CustomerID)
	validID(v.PlanID)
	v.CustomerID = strings.ToLower(v.CustomerID)
	v.PlanID = strings.ToLower(v.PlanID)
	if v.RequestKey != nil {
		validID(*v.RequestKey)
		key := strings.ToLower(*v.RequestKey)
		v.RequestKey = &key
	}
	parseDate(v.Start)
	parseDate(v.End)
	parseDate(v.QuoteUntil)
	require(v.End > v.Start && terms >= 0 && terms <= 365, 400, "VALIDATION", "Invalid subscription dates or payment terms.")
	validateLines(v.Lines)
	for i := range v.Lines {
		line := &v.Lines[i]
		line.ProductID = strings.ToLower(line.ProductID)
		if line.VariantID != nil {
			id := strings.ToLower(*line.VariantID)
			line.VariantID = &id
		}
		if line.TaxID != nil {
			id := strings.ToLower(*line.TaxID)
			line.TaxID = &id
		}
	}
	canonical := v
	canonical.RequestKey = nil
	canonical.Terms = &terms
	payload, err := json.Marshal(canonical)
	check(err)
	return a.subscriptionCreationTx(ctx, v.RequestKey != nil, func(tx pgx.Tx) any {
		// All plan/product/variant/tax values must come from one catalog snapshot.
		// Conflicting catalog writes abort rather than mixing revisions; only
		// keyed creation can restart against a fresh snapshot.
		exec(ctx, tx, "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
		var subscriptionID any
		if v.RequestKey != nil {
			previous := rows(ctx, tx, `SELECT subscription_id,payload=$3::jsonb AS matches FROM subscription_create_requests WHERE actor_id=$1 AND request_key=$2`, u.ID, *v.RequestKey, payload)
			if len(previous) != 0 {
				require(truth(previous[0]["matches"]), 409, "CONFLICT", "Request key was already used with different subscription details.")
				return one(ctx, tx, "SELECT * FROM subscriptions WHERE id=$1", previous[0]["subscription_id"])
			}
			// Reserve before consulting mutable catalog/time rules. A concurrent
			// winner causes 23505/40001, handled above with a fresh snapshot.
			// The deferred FK requires the subscription to exist at commit.
			reservation := one(ctx, tx, `INSERT INTO subscription_create_requests(actor_id,request_key,payload,subscription_id) VALUES($1,$2,$3,gen_random_uuid()) RETURNING subscription_id`, u.ID, *v.RequestKey, payload)
			subscriptionID = reservation["subscription_id"]
		}
		now := today()
		require(v.End > now && v.QuoteUntil >= now, 400, "INVALID_DATE", "Subscription and quotation must not be expired.")
		one(ctx, tx, "SELECT id FROM customers WHERE id=$1 FOR KEY SHARE", v.CustomerID)
		plan := one(ctx, tx, "SELECT * FROM plans WHERE id=$1 FOR SHARE", v.PlanID)
		require(v.Start >= str(plan["available_from"]) && (plan["available_until"] == nil || v.Start <= str(plan["available_until"])), 400, "PLAN_UNAVAILABLE", "Start is outside plan availability.")
		quantity := 0
		for _, line := range v.Lines {
			quantity += line.Quantity
		}
		require(quantity >= integer(plan["min_quantity"]), 400, "MINIMUM_QUANTITY", "Plan minimum quantity not met.")
		resolvedLines := make([]Object, len(v.Lines))
		priced := make([]pricedLine, 0, len(v.Lines)+1)
		for i, line := range v.Lines {
			resolved := resolveLine(ctx, tx, line)
			resolvedLines[i] = resolved
			priced = append(priced, pricedLine{Quantity: line.Quantity, Unit: number(resolved["unit_price"]), Tax: number(resolved["tax_rate"])})
		}
		priced = append(priced, pricedLine{Quantity: 1, Unit: number(plan["price"]), Tax: number("0")})
		_, subtotal, _, _, total := calculate(priced, nil)
		limit := number("99999999999999.99")
		require(subtotal.LessThanOrEqual(limit) && total.LessThanOrEqual(limit), 400, "VALIDATION", "Recurring amount exceeds the supported billing limit.")
		snap, e := json.Marshal(plan)
		check(e)
		s := one(ctx, tx, `INSERT INTO subscriptions(customer_id,plan_id,start_date,end_date,quote_valid_until,payment_terms_days,next_billing_date,anchor_day,currency,plan_snapshot,billing_anchor,id) VALUES($1,$2,$3,$4,$5,$6,$3,$7,$8,$9,$3,COALESCE($10::uuid,gen_random_uuid())) RETURNING *`, v.CustomerID, v.PlanID, v.Start, v.End, v.QuoteUntil, terms, parseDate(v.Start).Day(), a.Currency, snap, subscriptionID)
		for i, line := range v.Lines {
			resolved := resolvedLines[i]
			exec(ctx, tx, `INSERT INTO subscription_lines(subscription_id,product_id,variant_id,description,quantity,unit_price,tax_rate) VALUES($1,$2,$3,$4,$5,$6,$7)`, s["id"], line.ProductID, line.VariantID, resolved["description"], line.Quantity, resolved["unit_price"], resolved["tax_rate"])
		}
		audit(ctx, tx, u, "subscription.create", str(s["id"]))
		return s
	})
}
func (a *App) transition(w http.ResponseWriter, r *http.Request) any {
	u := a.user(r)
	v := body[LifecycleInput](w, r)
	ctx := r.Context()
	recordID := r.PathValue("id")
	return a.tx(ctx, func(tx pgx.Tx) any {
		s := owned(ctx, tx, "subscriptions", recordID, u, true)
		plan := s["plan_snapshot"].(map[string]any)
		status := str(s["status"])
		paused := truth(s["paused"])
		end, next := str(s["end_date"]), str(s["next_billing_date"])
		anchor := integer(s["anchor_day"])
		billingAnchor := str(s["billing_anchor"])
		reason := s["close_reason"]
		now := today()
		switch v.Action {
		case "quote", "confirm", "activate":
			internal(u)
		}
		billingDue := !paused && next <= now && next < end
		switch v.Action {
		case "quote":
			require(status == "Draft", 409, "INVALID_TRANSITION", "Only drafts can become quotations.")
			require(str(s["quote_valid_until"]) >= now && end > now, 409, "INVALID_TRANSITION", "Subscription or quotation has expired.")
			status = "Quotation"
		case "confirm":
			require(status == "Quotation" && str(s["quote_valid_until"]) >= now && end > now, 409, "INVALID_TRANSITION", "Subscription or quotation is invalid or expired.")
			status = "Confirmed"
		case "activate":
			require(status == "Confirmed" && end > now, 409, "INVALID_TRANSITION", "Only unexpired confirmed subscriptions can activate.")
			status = "Active"
		case "pause":
			require(status == "Active" && !paused && truth(plan["allow_pause"]) && str(s["start_date"]) <= now && end > now, 409, "INVALID_TRANSITION", "Pause requires an eligible active subscription.")
			require(!billingDue, 409, "BILLING_DUE", "Process due invoices before pausing.")
			paused = true
		case "resume":
			require(status == "Active" && paused && end > now, 409, "INVALID_TRANSITION", "Only an unexpired paused subscription can resume.")
			paused = false
			if next <= now {
				next = now
				anchor = parseDate(next).Day()
				billingAnchor = next
			}
		case "close":
			require(status == "Active" && truth(plan["allow_close"]), 409, "INVALID_TRANSITION", "Early closure not permitted.")
			require(!billingDue, 409, "BILLING_DUE", "Process due invoices before closure.")
			status = "Closed"
			paused = false
			reason = "cancelled"
			if end <= now {
				reason = "expired"
			}
		case "renew":
			require(status == "Active" && truth(plan["allow_renew"]) && end > now && str(s["start_date"]) <= now, 409, "INVALID_TRANSITION", "Only active nonexpired subscriptions can renew.")
			parseDate(v.End)
			require(v.End > end, 400, "INVALID_DATE", "Renewal must extend the current end date.")
			end = v.End
		default:
			panic(fault{400, "VALIDATION", "Unknown lifecycle action."})
		}
		result := one(ctx, tx, "UPDATE subscriptions SET status=$1,paused=$2,end_date=$3,next_billing_date=$4,anchor_day=$5,close_reason=$6,billing_anchor=$8 WHERE id=$7 RETURNING *", status, paused, end, next, anchor, reason, recordID, billingAnchor)
		audit(ctx, tx, u, "subscription."+v.Action, recordID)
		return result
	})
}
