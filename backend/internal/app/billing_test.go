package app

import (
	"fmt"
	"testing"

	"github.com/shopspring/decimal"
)

func billingTestLine(product, unit, tax string, quantity int) pricedLine {
	return pricedLine{ProductID: product, Quantity: quantity, Unit: number(unit), Tax: number(tax)}
}

func TestCalculateInvoice(t *testing.T) {
	products := []pricedLine{billingTestLine("a", "20", "10", 2), billingTestLine("b", "30", "20", 1), billingTestLine("", "10", "0", 1)}
	for _, tc := range []struct {
		name                         string
		lines                        []pricedLine
		discount                     Object
		subtotal, saving, tax, total string
	}{
		{"tax and base fee", []pricedLine{billingTestLine("a", "12.34", "8.25", 3), billingTestLine("", "5", "0", 1)}, nil, "42.02", "0.00", "3.05", "45.07"},
		{"product scoped", products, Object{"kind": "fixed", "value": "12", "product_id": "a"}, "80.00", "12.00", "8.80", "76.80"},
		{"whole subscription", products, Object{"kind": "percentage", "value": "10", "product_id": nil}, "80.00", "8.00", "9.00", "81.00"},
		{"capped at eligible base", products, Object{"kind": "fixed", "value": "999", "product_id": "a"}, "80.00", "40.00", "6.00", "46.00"},
		{"no eligible product", products, Object{"kind": "fixed", "value": "999", "product_id": "missing"}, "80.00", "0.00", "10.00", "90.00"},
		{"zero base", []pricedLine{billingTestLine("a", "0", "100", 1)}, Object{"kind": "fixed", "value": "5"}, "0.00", "0.00", "0.00", "0.00"},
		{"percentage rounding", []pricedLine{billingTestLine("a", "0.01", "100", 1), billingTestLine("b", "0.01", "100", 1), billingTestLine("c", "0.01", "100", 1)}, Object{"kind": "percentage", "value": "50"}, "0.03", "0.02", "0.01", "0.02"},
		{"large exact amount", []pricedLine{billingTestLine("a", "999999999999.99", "0", 1)}, Object{"kind": "fixed", "value": "0.01"}, "999999999999.99", "0.01", "0.00", "999999999999.98"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			lines, subtotal, saving, tax, total := calculate(append([]pricedLine(nil), tc.lines...), tc.discount)
			if subtotal.StringFixed(2) != tc.subtotal || saving.StringFixed(2) != tc.saving || tax.StringFixed(2) != tc.tax || total.StringFixed(2) != tc.total {
				t.Fatalf("totals = %s, %s, %s, %s; want %s, %s, %s, %s", subtotal, saving, tax, total, tc.subtotal, tc.saving, tc.tax, tc.total)
			}
			assertBillingLineTotals(t, lines, subtotal, saving, tax, total)
			for _, line := range lines {
				if tc.discount != nil && tc.discount["product_id"] != nil && line.ProductID != tc.discount["product_id"] && !line.Discount.IsZero() {
					t.Fatal("discount escaped its product scope")
				}
			}
		})
	}
}

func assertBillingLineTotals(t *testing.T, lines []pricedLine, subtotal, saving, tax, total decimal.Decimal) {
	t.Helper()
	baseSum, discountSum, taxSum, totalSum := decimal.Zero, decimal.Zero, decimal.Zero, decimal.Zero
	for _, line := range lines {
		if line.Discount.IsNegative() || line.Discount.GreaterThan(line.Base) || !line.Total.Equal(line.Base.Sub(line.Discount).Add(line.TaxAmount)) {
			t.Fatalf("invalid calculated line: %#v", line)
		}
		baseSum = baseSum.Add(line.Base)
		discountSum = discountSum.Add(line.Discount)
		taxSum = taxSum.Add(line.TaxAmount)
		totalSum = totalSum.Add(line.Total)
	}
	if !baseSum.Equal(subtotal) || !discountSum.Equal(saving) || !taxSum.Equal(tax) || !totalSum.Equal(total) || !subtotal.Sub(saving).Add(tax).Equal(total) {
		t.Fatal("line allocations do not reconcile exactly with invoice totals")
	}
}

func TestCalculateManyLinesAndRecalculation(t *testing.T) {
	lines := make([]pricedLine, 100)
	for i := range lines {
		lines[i] = billingTestLine("a", fmt.Sprintf("%d.%02d", (i+1)/100, (i+1)%100), "19.125", 1)
	}
	computed, subtotal, saving, tax, total := calculate(lines, Object{"kind": "percentage", "value": "33.33"})
	if subtotal.StringFixed(2) != "50.50" || saving.StringFixed(2) != "16.83" {
		t.Fatalf("incorrect many-line discount: subtotal=%s saving=%s", subtotal, saving)
	}
	assertBillingLineTotals(t, computed, subtotal, saving, tax, total)
	computed, subtotal, saving, tax, total = calculate(computed, nil)
	if !saving.IsZero() {
		t.Fatal("recalculation retained an old discount")
	}
	assertBillingLineTotals(t, computed, subtotal, saving, tax, total)
}

func TestBillingCalendarBoundaries(t *testing.T) {
	for _, tc := range []struct{ start, cadence, anchor, want string }{
		{"2026-12-31", "daily", "2026-01-01", "2027-01-01"},
		{"2026-10-31", "weekly", "2026-10-01", "2026-11-05"},
		{"2026-10-01", "weekly", "2026-10-01", "2026-10-08"},
		{"2026-01-31", "monthly", "2026-01-31", "2026-02-28"},
		{"2026-02-28", "monthly", "2026-01-31", "2026-03-31"},
		{"2026-02-15", "monthly", "2026-01-31", "2026-02-28"},
		{"2028-02-29", "yearly", "2024-02-29", "2029-02-28"},
		{"2027-02-28", "yearly", "2024-02-29", "2028-02-29"},
		{"2026-06-15", "yearly", "2026-10-31", "2026-10-31"},
	} {
		t.Run(tc.start+"/"+tc.cadence, func(t *testing.T) {
			if got := nextPeriod(tc.start, tc.cadence, tc.anchor); got != tc.want {
				t.Fatalf("next period = %s; want %s", got, tc.want)
			}
		})
	}
	// Calendar computation for a large catch-up is pure: no database or worker is run.
	for _, cadence := range []string{"daily", "weekly", "monthly", "yearly"} {
		start, anchor := "2024-01-31", "2024-01-31"
		seen := map[string]bool{}
		for period := 0; period < 500; period++ {
			end := nextPeriod(start, cadence, anchor)
			if end <= start || seen[end] {
				t.Fatalf("non-advancing/duplicate %s boundary at %s", cadence, end)
			}
			seen[end] = true
			start = end
		}
	}
}
