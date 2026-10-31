package app

import "testing"

const domainProductID = "11111111-1111-4111-8111-111111111111"
const domainVariantID = "22222222-2222-4222-8222-222222222222"
const domainTaxID = "33333333-3333-4333-8333-333333333333"

func expectDomainValidation(t *testing.T, fn func()) {
	t.Helper()
	defer func() {
		recovered := recover()
		f, ok := recovered.(fault)
		if !ok || f.Status != 400 || f.Code != "VALIDATION" {
			t.Fatalf("expected validation fault, got %#v", recovered)
		}
	}()
	fn()
}

func TestValidateSubscriptionLines(t *testing.T) {
	variant, tax := domainVariantID, domainTaxID
	for _, quantity := range []int{1, 100000} {
		validateLines([]LineInput{{ProductID: domainProductID, VariantID: &variant, TaxID: &tax, Quantity: quantity}})
	}
	lines := make([]LineInput, 100)
	for i := range lines {
		lines[i] = LineInput{ProductID: domainProductID, Quantity: 1}
	}
	validateLines(lines)

	invalidID := "not-a-uuid"
	tests := []struct {
		name  string
		lines []LineInput
	}{
		{"nil", nil},
		{"empty", []LineInput{}},
		{"too many lines", append(lines, lines[0])},
		{"invalid product", []LineInput{{ProductID: invalidID, Quantity: 1}}},
		{"invalid variant", []LineInput{{ProductID: domainProductID, VariantID: &invalidID, Quantity: 1}}},
		{"invalid tax", []LineInput{{ProductID: domainProductID, TaxID: &invalidID, Quantity: 1}}},
		{"zero quantity", []LineInput{{ProductID: domainProductID, Quantity: 0}}},
		{"negative quantity", []LineInput{{ProductID: domainProductID, Quantity: -1}}},
		{"excessive quantity", []LineInput{{ProductID: domainProductID, Quantity: 100001}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			expectDomainValidation(t, func() { validateLines(tt.lines) })
		})
	}
}
