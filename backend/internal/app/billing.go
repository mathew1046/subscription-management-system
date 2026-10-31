package app

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
	"log/slog"
	"net/http"
)

type pricedLine struct {
	Description, ProductID                      string
	Quantity                                    int
	Unit, Tax, Base, Discount, TaxAmount, Total decimal.Decimal
}

func calculate(lines []pricedLine, discount Object) ([]pricedLine, decimal.Decimal, decimal.Decimal, decimal.Decimal, decimal.Decimal) {
	subtotal, eligible := decimal.Zero, decimal.Zero
	for i := range lines {
		lines[i].Base = lines[i].Unit.Mul(decimal.NewFromInt(int64(lines[i].Quantity))).Round(2)
		subtotal = subtotal.Add(lines[i].Base)
		if discount != nil && (discount["product_id"] == nil || str(discount["product_id"]) == lines[i].ProductID) {
			eligible = eligible.Add(lines[i].Base)
		}
	}
	saving := decimal.Zero
	if discount != nil && eligible.IsPositive() {
		saving = number(discount["value"])
		if discount["kind"] == "percentage" {
			saving = eligible.Mul(saving).DivRound(decimal.NewFromInt(100), 2)
		}
		saving = decimal.Min(saving.Round(2), eligible)
	}
	remaining, remainingBase := saving, eligible
	tax, total := decimal.Zero, decimal.Zero
	for i := range lines {
		l := &lines[i]
		l.Discount = decimal.Zero
		if discount != nil && (discount["product_id"] == nil || str(discount["product_id"]) == l.ProductID) && l.Base.IsPositive() {
			if l.Base.Equal(remainingBase) {
				l.Discount = remaining
			} else {
				l.Discount = decimal.Min(remaining.Mul(l.Base).DivRound(remainingBase, 2), l.Base)
			}
			remaining = remaining.Sub(l.Discount)
			remainingBase = remainingBase.Sub(l.Base)
		}
		net := l.Base.Sub(l.Discount)
		l.TaxAmount = net.Mul(l.Tax).DivRound(decimal.NewFromInt(100), 2)
		l.Total = net.Add(l.TaxAmount)
		tax = tax.Add(l.TaxAmount)
		total = total.Add(l.Total)
	}
	return lines, subtotal, saving, tax, total
}
func (a *App) billOne(ctx context.Context, recordID string) (processed bool, err error) {
	defer func() {
		if p := recover(); p != nil {
			if e, ok := p.(error); ok {
				err = fmt.Errorf("billing failed: %w", e)
			} else {
				err = fmt.Errorf("billing failed: %T", p)
			}
		}
	}()
	result := a.tx(ctx, func(tx pgx.Tx) any {
		issued := today()
		matches := rows(ctx, tx, "SELECT * FROM subscriptions WHERE id=$1 AND status='Active' AND paused=false AND start_date<=$2::date AND next_billing_date<=$2::date AND next_billing_date<end_date AND (retry_after IS NULL OR retry_after<=now()) FOR UPDATE SKIP LOCKED", recordID, issued)
		if len(matches) == 0 {
			return false
		}
		s := matches[0]
		plan := s["plan_snapshot"].(map[string]any)
		start := str(s["next_billing_date"])
		require(start >= str(s["start_date"]), 409, "BILLING_CURSOR", "Billing cursor precedes subscription start.")
		end := nextPeriod(start, str(plan["cadence"]), integer(s["anchor_day"]))
		if end > str(s["end_date"]) {
			end = str(s["end_date"])
		}
		existing := rows(ctx, tx, "SELECT period_end FROM invoices WHERE subscription_id=$1 AND period_start=$2", recordID, start)
		if len(existing) > 0 {
			// Recover from the immutable billed period, never a newly recomputed cadence.
			end = str(existing[0]["period_end"])
			require(end > start && end <= str(s["end_date"]), 409, "BILLING_CURSOR", "Existing invoice period conflicts with subscription dates.")
			exec(ctx, tx, "UPDATE subscriptions SET next_billing_date=$1,billing_error=NULL,retry_after=NULL WHERE id=$2", end, recordID)
			return false
		}
		stored := rows(ctx, tx, "SELECT * FROM subscription_lines WHERE subscription_id=$1 ORDER BY id", recordID)
		lines := []pricedLine{}
		quantity := 0
		for _, l := range stored {
			q := integer(l["quantity"])
			quantity += q
			lines = append(lines, pricedLine{Description: str(l["description"]), ProductID: str(l["product_id"]), Quantity: q, Unit: number(l["unit_price"]), Tax: number(l["tax_rate"])})
		}
		if number(plan["price"]).IsPositive() {
			lines = append(lines, pricedLine{Description: str(plan["name"]) + " — recurring base fee", Quantity: 1, Unit: number(plan["price"]), Tax: decimal.Zero})
		}
		_, subtotal, _, _, _ := calculate(lines, nil)
		// Stable lock ordering serializes capped discount consumption across workers.
		discounts := rows(ctx, tx, "SELECT * FROM discounts WHERE starts_on<=$1 AND ends_on>=$1 AND uses<max_uses AND min_purchase<=$2 AND min_quantity<=$3 ORDER BY id FOR UPDATE", start, subtotal.StringFixed(2), quantity)
		var chosen Object
		best := decimal.Zero
		for _, d := range discounts {
			_, _, saving, _, _ := calculate(append([]pricedLine(nil), lines...), d)
			if saving.GreaterThan(best) {
				chosen = d
				best = saving
			}
		}
		computed, subtotal, saving, tax, total := calculate(lines, chosen)
		customer := one(ctx, tx, "SELECT name,email,address FROM customers WHERE id=$1", s["customer_id"])
		customerJSON, e := json.Marshal(customer)
		check(e)
		var discountID any
		var discountJSON []byte
		if chosen != nil {
			discountID = chosen["id"]
			discountJSON, e = json.Marshal(chosen)
			check(e)
		}
		invoice := one(ctx, tx, `INSERT INTO invoices(subscription_id,customer_id,customer_snapshot,period_start,period_end,issued_on,due_on,currency,subtotal,discount_total,tax_total,total,discount_id,discount_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`, recordID, s["customer_id"], customerJSON, start, end, issued, addDays(issued, integer(s["payment_terms_days"])), s["currency"], subtotal.StringFixed(2), saving.StringFixed(2), tax.StringFixed(2), total.StringFixed(2), discountID, discountJSON)
		for _, l := range computed {
			exec(ctx, tx, "INSERT INTO invoice_lines(invoice_id,description,quantity,unit_price,discount_amount,tax_rate,tax_amount,total) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", invoice["id"], l.Description, l.Quantity, l.Unit.StringFixed(2), l.Discount.StringFixed(2), l.Tax.String(), l.TaxAmount.StringFixed(2), l.Total.StringFixed(2))
		}
		if chosen != nil {
			exec(ctx, tx, "UPDATE discounts SET uses=uses+1 WHERE id=$1", chosen["id"])
		}
		exec(ctx, tx, "UPDATE subscriptions SET next_billing_date=$1,billing_error=NULL,retry_after=NULL WHERE id=$2", end, recordID)
		return true
	})
	return result.(bool), nil
}
func (a *App) Billing(ctx context.Context) Object {
	processed, failed := 0, 0
	// Bounded passes catch up backlogs without a single unbounded request/transaction.
	for pass := 0; pass < 3; pass++ {
		if ctx.Err() != nil {
			break
		}
		ids := rows(ctx, a.DB, "SELECT id,next_billing_date FROM subscriptions WHERE status='Active' AND paused=false AND start_date<=$1::date AND next_billing_date<=$1::date AND next_billing_date<end_date AND (retry_after IS NULL OR retry_after<=now()) ORDER BY next_billing_date,id LIMIT 100", today())
		if len(ids) == 0 {
			break
		}
		for _, s := range ids {
			if ctx.Err() != nil {
				break
			}
			done, e := a.billOne(ctx, str(s["id"]))
			if e != nil {
				failed++
				// Do not overwrite success if another worker has already advanced this period.
				_, _ = a.DB.Exec(ctx, "UPDATE subscriptions SET billing_error='Billing failed; review worker logs and configuration',retry_after=now()+interval '5 minutes' WHERE id=$1 AND next_billing_date=$2", s["id"], s["next_billing_date"])
				slog.Error("billing transaction failed", "subscription_id", s["id"], "error", e)
			} else if done {
				processed++
			}
		}
	}
	if ctx.Err() == nil {
		exec(ctx, a.DB, `WITH expired AS (
			SELECT id FROM subscriptions WHERE status='Active' AND end_date<=$1::date
			AND (paused=true OR next_billing_date>=end_date) AND (plan_snapshot->>'auto_close')::boolean=true
			ORDER BY end_date,id LIMIT 100 FOR UPDATE SKIP LOCKED
		) UPDATE subscriptions s SET status='Closed',close_reason='expired' FROM expired WHERE s.id=expired.id`, today())
	}
	return Object{"processed": processed, "failed": failed}
}
func (a *App) runBilling(w http.ResponseWriter, r *http.Request) any {
	u := a.user(r)
	internal(u)
	return a.Billing(r.Context())
}
