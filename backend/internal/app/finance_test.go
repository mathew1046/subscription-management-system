package app

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func expectFinanceValidation(t *testing.T, fn func()) {
	t.Helper()
	defer func() {
		p := recover()
		f, ok := p.(fault)
		if !ok || f.Status != 400 || f.Code != "VALIDATION" {
			t.Fatalf("expected validation fault, got %#v", p)
		}
	}()
	fn()
}

func TestReportFilters(t *testing.T) {
	for _, tc := range []struct {
		name, query, from, to, customer string
		payments                        bool
	}{
		{"defaults", "", "2026-10-01", "2026-10-31", "", false},
		{"explicit", "from=2026-09-01&to=2026-09-30&include_payments=true", "2026-09-01", "2026-09-30", "", true},
		{"single day", "from=2026-10-31&include_payments=false", "2026-10-31", "2026-10-31", "", false},
		{"normalized customer", "customer_id=ABCDEF01-2345-6789-ABCD-EF0123456789", "2026-10-01", "2026-10-31", "abcdef01-2345-6789-abcd-ef0123456789", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			from, to, customer, payments := reportFilters(httptest.NewRequest("GET", "/api/reports?"+tc.query, nil), "2026-10-31")
			if from != tc.from || to != tc.to || customer != tc.customer || payments != tc.payments {
				t.Fatalf("filters = %q, %q, %q, %t", from, to, customer, payments)
			}
		})
	}
	for _, query := range []string{
		"from=2026-02-29", "to=2026-13-01", "from=2026-1-01", "from=2026-10-31&to=2026-10-30",
		"customer_id=not-a-uuid", "include_payments=1", "include_payments=TRUE",
	} {
		t.Run(query, func(t *testing.T) {
			expectFinanceValidation(t, func() {
				reportFilters(httptest.NewRequest("GET", "/api/reports?"+query, nil), "2026-10-31")
			})
		})
	}
}

func financePaymentInput() PaymentInput {
	return PaymentInput{
		InvoiceID: "ABCDEF01-2345-6789-ABCD-EF0123456789", RequestKey: "ABCDEF02-2345-6789-ABCD-EF0123456789",
		Amount: "123.45", Method: "bank_transfer", PaidOn: "2026-10-31", Note: "Bank reference 123",
	}
}

func TestValidatePayment(t *testing.T) {
	for _, method := range []string{"bank_transfer", "cash", "card", "upi", "other"} {
		v := financePaymentInput()
		v.Method = method
		got := validatePayment(v, "2026-10-31")
		if got.InvoiceID != strings.ToLower(v.InvoiceID) || got.RequestKey != strings.ToLower(v.RequestKey) || got.Method != method || got.Note != v.Note {
			t.Fatalf("payment normalization lost fields: %#v", got)
		}
	}
	for _, tc := range []struct {
		name   string
		change func(*PaymentInput)
	}{
		{"invalid invoice", func(v *PaymentInput) { v.InvoiceID = "missing" }},
		{"invalid key", func(v *PaymentInput) { v.RequestKey = "missing" }},
		{"zero", func(v *PaymentInput) { v.Amount = "0.00" }},
		{"negative", func(v *PaymentInput) { v.Amount = "-1" }},
		{"exponent", func(v *PaymentInput) { v.Amount = "1e2" }},
		{"fractional cent", func(v *PaymentInput) { v.Amount = "0.001" }},
		{"too large", func(v *PaymentInput) { v.Amount = "1000000000000" }},
		{"invalid date", func(v *PaymentInput) { v.PaidOn = "2026-02-29" }},
		{"future date", func(v *PaymentInput) { v.PaidOn = "2026-11-01" }},
		{"long note", func(v *PaymentInput) { v.Note = strings.Repeat("x", 2001) }},
		{"unknown method", func(v *PaymentInput) { v.Method = "wire" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			v := financePaymentInput()
			tc.change(&v)
			expectFinanceValidation(t, func() { validatePayment(v, "2026-10-31") })
		})
	}
}

func TestPaymentMatches(t *testing.T) {
	v := validatePayment(financePaymentInput(), "2026-10-31")
	p := Object{"invoice_id": v.InvoiceID, "amount": "123.4500", "method": v.Method, "paid_on": v.PaidOn, "note": v.Note}
	if !paymentMatches(p, v) {
		t.Fatal("same payment must match despite decimal representation")
	}
	changes := Object{
		"invoice_id": "abcdef03-2345-6789-abcd-ef0123456789", "amount": "123.46", "method": "cash", "paid_on": "2026-10-30", "note": "another reference",
	}
	for key, value := range changes {
		t.Run(key, func(t *testing.T) {
			changed := Object{}
			for k, original := range p {
				changed[k] = original
			}
			changed[key] = value
			if paymentMatches(changed, v) {
				t.Fatalf("different %s must not reuse a payment key", key)
			}
		})
	}
}

func TestFinancePaymentPagination(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/reports?include_payments=true&page=2&page_size=2", nil)
	page, size := pagination(r)
	result := paged([]Object{{"id": "first"}, {"id": "second"}, {"id": "next"}}, page, size)
	if result["page"] != 2 || result["page_size"] != 2 || result["has_more"] != true || len(result["items"].([]Object)) != 2 {
		t.Fatalf("incorrect payment page: %#v", result)
	}
	for _, query := range []string{"page=0", "page=100001", "page_size=0", "page_size=101", "page=abc"} {
		t.Run(query, func(t *testing.T) {
			expectFinanceValidation(t, func() { pagination(httptest.NewRequest("GET", "/api/reports?"+query, nil)) })
		})
	}
}
