package app

import (
	"reflect"
	"testing"
)

func domainPlan() Object {
	return Object{"name": "Monthly seats", "price": "25.50", "cadence": "monthly", "min_quantity": float64(1), "available_from": "2026-01-01"}
}

func TestPlanCadencesAndPolicies(t *testing.T) {
	for _, cadence := range []string{"daily", "weekly", "monthly", "yearly"} {
		t.Run(cadence, func(t *testing.T) {
			input := domainPlan()
			input["cadence"] = cadence
			plan := validateResource("plans", input)
			for key, want := range (Object{"auto_close": true, "allow_close": true, "allow_pause": false, "allow_renew": true, "available_until": nil}) {
				if plan[key] != want {
					t.Errorf("%s = %v, want %v", key, plan[key], want)
				}
			}
		})
	}
	input := domainPlan()
	for key, value := range (Object{"auto_close": false, "allow_close": false, "allow_pause": true, "allow_renew": false, "available_until": "2026-01-01"}) {
		input[key] = value
	}
	want := Object{}
	for key, value := range input {
		want[key] = value
	}
	if got := validateResource("plans", input); !reflect.DeepEqual(got, want) {
		t.Fatalf("explicit policies or inclusive availability changed: got %#v, want %#v", got, want)
	}
}

func TestPlanRejectsInvalidPoliciesAndAvailability(t *testing.T) {
	tests := []struct {
		name  string
		key   string
		value any
	}{
		{"unsupported cadence", "cadence", "quarterly"},
		{"nonboolean policy", "allow_pause", "true"},
		{"null policy", "auto_close", nil},
		{"backward availability", "available_until", "2025-12-31"},
		{"invalid date", "available_until", "2026-02-30"},
		{"zero quantity", "min_quantity", float64(0)},
		{"fractional quantity", "min_quantity", 1.5},
		{"excessive quantity", "min_quantity", float64(100001)},
		{"numeric price", "price", 25.50},
		{"negative price", "price", "-1"},
		{"imprecise price", "price", "25.501"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := domainPlan()
			input[tt.key] = tt.value
			expectDomainValidation(t, func() { validateResource("plans", input) })
		})
	}
}

func TestProductAndVariantAmounts(t *testing.T) {
	product := validateResource("products", Object{"name": " Software ", "type": "software", "sale_price": "100.10", "cost_price": "25.00"})
	if product["name"] != "Software" || product["notes"] != "" || product["archived"] != false || product["sale_price"] != "100.10" {
		t.Fatalf("unexpected product defaults or amount: %#v", product)
	}
	variant := validateResource("variants", Object{"product_id": domainProductID, "name": "Odoo", "price_delta": "560"})
	if variant["price_delta"] != "560" || variant["product_id"] != domainProductID {
		t.Fatalf("unexpected variant: %#v", variant)
	}
	defaultVariant := validateResource("variants", Object{"product_id": domainProductID, "name": "Default"})
	if defaultVariant["price_delta"] != "0" {
		t.Fatalf("default delta = %v, want 0", defaultVariant["price_delta"])
	}
}

func TestQuotationTemplateLines(t *testing.T) {
	input := []Object{{"product_id": domainProductID, "variant_id": domainVariantID, "tax_id": domainTaxID, "quantity": float64(3)}}
	lines := quotationLines(input)
	if len(lines) != 1 || lines[0].ProductID != domainProductID || lines[0].VariantID == nil || *lines[0].VariantID != domainVariantID || lines[0].TaxID == nil || *lines[0].TaxID != domainTaxID || lines[0].Quantity != 3 {
		t.Fatalf("unexpected decoded lines: %#v", lines)
	}
	for _, days := range []float64{1, 365} {
		template := validateResource("quotation-templates", Object{"name": "Seats", "plan_id": domainProductID, "valid_days": days, "lines": input})
		if template["valid_days"] != days || template["plan_id"] != domainProductID {
			t.Fatalf("unexpected template: %#v", template)
		}
	}
	for _, days := range []any{float64(0), float64(366), 1.5, "14"} {
		expectDomainValidation(t, func() {
			validateResource("quotation-templates", Object{"name": "Seats", "plan_id": domainProductID, "valid_days": days, "lines": input})
		})
	}
}

func TestQuotationTemplateRejectsInvalidLines(t *testing.T) {
	tests := []struct {
		name  string
		value any
	}{
		{"null", nil},
		{"empty", []Object{}},
		{"object instead of list", Object{"product_id": domainProductID, "quantity": 1}},
		{"missing product", []Object{{"quantity": 1}}},
		{"missing quantity", []Object{{"product_id": domainProductID}}},
		{"fractional quantity", []Object{{"product_id": domainProductID, "quantity": 1.5}}},
		{"string quantity", []Object{{"product_id": domainProductID, "quantity": "1"}}},
		{"injected price", []Object{{"product_id": domainProductID, "quantity": 1, "unit_price": "0"}}},
		{"injected tax", []Object{{"product_id": domainProductID, "quantity": 1, "tax_rate": "0"}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			expectDomainValidation(t, func() { quotationLines(tt.value) })
		})
	}
}
