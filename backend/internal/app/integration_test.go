package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

// Opt in with a fresh disposable database named brightloop_test_*; never use
// the running demo/business database. Migrations include public-schema DDL.
func TestPostgresSubscriptionWorkflow(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to a fresh disposable brightloop_test_* database")
	}
	t.Setenv("DATABASE_URL", dsn)
	t.Setenv("APP_ORIGIN", "http://localhost:3000")
	t.Setenv("APP_CURRENCY", "INR")
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	a, err := New(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer a.DB.Close()
	var database string
	var existing bool
	if err := a.DB.QueryRow(ctx, "SELECT current_database(),to_regclass('public.users') IS NOT NULL").Scan(&database, &existing); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(database, "brightloop_test_") || existing {
		t.Fatal("integration tests require a fresh disposable brightloop_test_* database")
	}
	if err := a.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(a.Routes())
	defer server.Close()
	a.Origin = server.URL
	newClient := func() *http.Client {
		jar, err := cookiejar.New(nil)
		if err != nil {
			t.Fatal(err)
		}
		return &http.Client{Jar: jar, Timeout: 25 * time.Second}
	}
	request := func(client *http.Client, method, path string, input any, status int) Object {
		t.Helper()
		var encoded []byte
		if input != nil {
			var err error
			encoded, err = json.Marshal(input)
			if err != nil {
				t.Fatal(err)
			}
		}
		r, err := http.NewRequestWithContext(ctx, method, server.URL+path, bytes.NewReader(encoded))
		if err != nil {
			t.Fatal(err)
		}
		r.Header.Set("Origin", server.URL)
		r.Header.Set("Content-Type", "application/json")
		response, err := client.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		body, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != status {
			t.Fatalf("%s %s: status %d, want %d: %s", method, path, response.StatusCode, status, body)
		}
		var envelope Object
		if err := json.Unmarshal(body, &envelope); err != nil {
			t.Fatal(err)
		}
		if status != http.StatusOK {
			return envelope["error"].(map[string]any)
		}
		return envelope["data"].(map[string]any)
	}
	password := "FixtureOnly!Aa9"
	a.register(ctx, Registration{Name: "Test administrator", Email: "admin@example.test", Password: password}, "admin")
	admin, customer, other := newClient(), newClient(), newClient()
	request(admin, "POST", "/api/auth/login", Object{"email": "ADMIN@example.test", "password": password}, 200)
	registration := Object{"name": "Customer", "email": "customer@example.test", "password": password}
	request(customer, "POST", "/api/auth/signup", registration, 200)
	request(customer, "POST", "/api/auth/signup", registration, 409)
	request(customer, "POST", "/api/auth/signup", Object{"name": "Bad role", "email": "bad@example.test", "password": password, "role": "admin"}, 400)
	request(customer, "POST", "/api/auth/login", registrationCredentials(registration), 200)
	request(other, "POST", "/api/auth/signup", Object{"name": "Other customer", "email": "other@example.test", "password": password}, 200)
	request(other, "POST", "/api/auth/login", Object{"email": "other@example.test", "password": password}, 200)
	staffInput := Object{"name": "Staff", "email": "staff@example.test", "password": password}
	request(customer, "POST", "/api/staff", staffInput, 403)
	request(admin, "POST", "/api/staff", staffInput, 200)
	staff := newClient()
	request(staff, "POST", "/api/auth/login", registrationCredentials(staffInput), 200)
	request(staff, "POST", "/api/staff", Object{"name": "Denied", "email": "denied@example.test", "password": password}, 403)
	request(customer, "GET", "/api/reports", nil, 403)
	catalog := request(admin, "GET", "/api/customers", nil, 200)["items"].([]any)
	var customerID string
	for _, item := range catalog {
		v := item.(map[string]any)
		if v["email"] == registration["email"] {
			customerID = str(v["id"])
		}
	}
	productInput := Object{"name": "Fixture product", "type": "software", "sale_price": "100.00", "cost_price": "10.00"}
	request(staff, "POST", "/api/products", productInput, 403)
	product := request(admin, "POST", "/api/products", productInput, 200)
	variant := request(admin, "POST", "/api/variants", Object{"name": "Odoo", "product_id": product["id"], "price_delta": "560.00"}, 200)
	tax := request(admin, "POST", "/api/taxes", Object{"name": "Fixture 5%", "rate": "5"}, 200)
	now, end := today(), addDays(today(), 400)
	plan := request(admin, "POST", "/api/plans", Object{"name": "Fixture monthly", "price": "0", "cadence": "monthly", "min_quantity": 1, "available_from": now, "auto_close": true, "allow_close": true, "allow_pause": true, "allow_renew": true}, 200)
	lines := []Object{{"product_id": product["id"], "variant_id": variant["id"], "quantity": 1, "tax_id": tax["id"]}}
	request(admin, "POST", "/api/quotation-templates", Object{"name": "Fixture offer", "plan_id": plan["id"], "valid_days": 30, "lines": lines}, 200)
	discount := request(admin, "POST", "/api/discounts", Object{"name": "Fixture capped discount", "kind": "percentage", "value": "10", "starts_on": now, "ends_on": end, "max_uses": 1, "product_id": product["id"]}, 200)
	sub := request(staff, "POST", "/api/subscriptions", Object{"customer_id": customerID, "plan_id": plan["id"], "start_date": now, "end_date": end, "quote_valid_until": now, "lines": lines}, 200)
	subID := str(sub["id"])
	if integer(sub["payment_terms_days"]) != 14 {
		t.Fatal("omitted payment terms did not default to 14")
	}
	detail := request(customer, "GET", "/api/subscriptions/"+subID, nil, 200)
	if !number(detail["quote_totals"].(map[string]any)["total"]).Equal(number("693.00")) {
		t.Fatal("variant +560 or automatic tax total is wrong")
	}
	request(other, "GET", "/api/subscriptions/"+subID, nil, 404)
	request(staff, "POST", "/api/subscriptions/"+subID+"/transition", Object{"action": "activate"}, 409)
	for _, action := range []string{"quote", "confirm", "activate"} {
		request(staff, "POST", "/api/subscriptions/"+subID+"/transition", Object{"action": action}, 200)
	}
	// Catalog edits must not rewrite the subscription's agreed price or invoices.
	productInput["sale_price"] = "999.00"
	request(admin, "PUT", "/api/products/"+str(product["id"]), productInput, 200)
	// Concurrent workers must generate exactly one invoice and consume one use.
	var wg sync.WaitGroup
	errors := make(chan any, 2)
	for range 2 {
		wg.Go(func() {
			defer func() {
				if p := recover(); p != nil {
					errors <- p
				}
			}()
			if result := a.Billing(ctx); integer(result["failed"]) != 0 {
				errors <- "billing reported failed periods"
			}
		})
	}
	wg.Wait()
	close(errors)
	for err := range errors {
		t.Fatalf("concurrent billing: %v", err)
	}
	invoices := request(staff, "GET", "/api/invoices?customer_id="+customerID, nil, 200)["items"].([]any)
	if len(invoices) != 1 {
		t.Fatalf("generated %d invoices for one period", len(invoices))
	}
	invoice := invoices[0].(map[string]any)
	invoiceID := str(invoice["id"])
	if !number(invoice["total"]).Equal(number("623.70")) {
		t.Fatalf("discount-before-tax total = %v, want 623.70", invoice["total"])
	}
	if got := one(ctx, a.DB, "SELECT uses FROM discounts WHERE id=$1", discount["id"]); integer(got["uses"]) != 1 {
		t.Fatal("discount was consumed more than once")
	}
	request(other, "GET", "/api/invoices/"+invoiceID, nil, 404)
	request(staff, "POST", "/api/invoices/"+invoiceID+"/confirm", Object{}, 200)
	// Backdate only this isolated fixture to exercise overdue views without
	// changing the clock or modifying any running demo records.
	yesterday := addDays(now, -1)
	exec(ctx, a.DB, "UPDATE invoices SET issued_on=$2::date,due_on=$2::date WHERE id=$1", invoiceID, yesterday)
	for _, status := range []string{"Outstanding", "Overdue"} {
		if got := request(staff, "GET", "/api/invoices?status="+status, nil, 200)["items"].([]any); len(got) != 1 {
			t.Fatalf("%s view omitted the unpaid fixture invoice", status)
		}
	}
	payment := Object{"invoice_id": invoiceID, "amount": "1.00", "method": "cash", "paid_on": now, "note": "Fixture", "request_key": "11111111-1111-4111-8111-111111111111"}
	first := request(staff, "POST", "/api/payments", payment, 200)
	partialReport := request(staff, "GET", "/api/reports?include_payments=true&customer_id="+customerID, nil, 200)
	if !number(partialReport["overdue"]).Equal(number("622.70")) || len(partialReport["payments"].(map[string]any)["items"].([]any)) != 1 {
		t.Fatalf("partial payment/overdue report is incorrect: %v", partialReport)
	}
	replay := request(staff, "POST", "/api/payments", payment, 200)
	if first["id"] != replay["id"] {
		t.Fatal("payment replay created a duplicate")
	}
	payment["amount"] = "2.00"
	request(staff, "POST", "/api/payments", payment, 409)
	payment["request_key"] = "22222222-2222-4222-8222-222222222222"
	payment["amount"] = "999999.00"
	request(staff, "POST", "/api/payments", payment, 400)
	request(staff, "POST", "/api/invoices/"+invoiceID+"/cancel", Object{}, 409)
	payment["amount"] = "622.70"
	request(staff, "POST", "/api/payments", payment, 200)
	settled := request(customer, "GET", "/api/invoices/"+invoiceID, nil, 200)
	if settled["status"] != "Paid" || !number(settled["balance"]).IsZero() {
		t.Fatal("invoice was not settled")
	}
	report := request(staff, "GET", "/api/reports?from="+yesterday+"&to="+now+"&customer_id="+customerID, nil, 200)
	if !number(report["collected"]).Equal(number("623.70")) || !number(report["billed"]).Equal(number("623.70")) || !number(report["outstanding"]).IsZero() || integer(report["active_subscriptions"]) != 1 {
		t.Fatalf("report did not reconcile the invoice and recorded payments: %v", report)
	}
	if _, exists := report["payments"]; exists {
		t.Fatal("default report shape changed without opting into the payment ledger")
	}
	for page := 1; page <= 3; page++ {
		ledger := request(staff, "GET", fmt.Sprintf("/api/reports?include_payments=true&page_size=1&page=%d&customer_id=%s", page, customerID), nil, 200)["payments"].(map[string]any)
		expected := 1
		if page == 3 {
			expected = 0
		}
		if len(ledger["items"].([]any)) != expected || truth(ledger["has_more"]) != (page == 1) {
			t.Fatalf("incorrect payment ledger page %d: %v", page, ledger)
		}
		for _, item := range ledger["items"].([]any) {
			p := item.(map[string]any)
			if p["customer_id"] != customerID || p["invoice_number"] != invoice["number"] || p["currency"] != "INR" {
				t.Fatalf("payment ledger lost invoice/customer context: %v", p)
			}
		}
	}
	for _, status := range []string{"Outstanding", "Overdue"} {
		if got := request(staff, "GET", "/api/invoices?status="+status, nil, 200)["items"].([]any); len(got) != 0 {
			t.Fatalf("%s view included a fully settled invoice", status)
		}
	}
	request(staff, "POST", "/api/invoices/"+invoiceID+"/send", Object{}, 200)
	request(staff, "POST", "/api/invoices/"+invoiceID+"/send", Object{}, 200)
	if integer(one(ctx, a.DB, "SELECT COUNT(*) AS count FROM outbox WHERE invoice_id=$1", invoiceID)["count"]) != 1 {
		t.Fatal("invoice send queued duplicate messages")
	}
	for _, action := range []string{"pause", "resume", "renew", "close"} {
		input := Object{"action": action}
		if action == "renew" {
			input["end_date"] = addDays(end, 30)
		}
		request(customer, "POST", "/api/subscriptions/"+subID+"/transition", input, 200)
	}
	request(customer, "POST", "/api/subscriptions/"+subID+"/transition", Object{"action": "renew", "end_date": addDays(end, 60)}, 409)
	// Reset tokens are opaque, one-use, and revoke every existing session.
	secondSession := newClient()
	request(secondSession, "POST", "/api/auth/login", registrationCredentials(registration), 200)
	request(customer, "POST", "/api/auth/forgot-password", Object{"email": registration["email"]}, 200)
	message := one(ctx, a.DB, "SELECT body FROM outbox WHERE subject='Reset your Brightloop password'")
	parts := strings.Split(str(message["body"]), "?token=")
	if len(parts) != 2 {
		t.Fatal("reset message did not contain an opaque token link")
	}
	reset := Object{"token": parts[1], "password": "ChangedFixture!Aa9"}
	request(customer, "POST", "/api/auth/reset-password", reset, 200)
	request(customer, "POST", "/api/auth/reset-password", reset, 400)
	request(customer, "GET", "/api/auth/me", nil, 401)
	request(secondSession, "GET", "/api/auth/me", nil, 401)
	request(customer, "POST", "/api/auth/login", registrationCredentials(registration), 401)
	request(customer, "POST", "/api/auth/login", Object{"email": registration["email"], "password": reset["password"]}, 200)
	// A bounded local API sample, not proof of every frontend page or load SLA.
	exec(ctx, a.DB, `INSERT INTO subscriptions(customer_id,plan_id,status,start_date,end_date,quote_valid_until,next_billing_date,anchor_day,currency,plan_snapshot,billing_anchor)
		SELECT $1,$2,'Active',$3::date,$4::date,$3::date,$3::date+1,EXTRACT(DAY FROM $3::date)::integer,'INR',$5,$3::date FROM generate_series(1,1000)`, customerID, plan["id"], now, end, plan)
	for _, path := range []string{"/api/subscriptions?page_size=100", "/api/invoices?page_size=100", "/api/reports"} {
		started := time.Now()
		request(admin, "GET", path, nil, 200)
		elapsed := time.Since(started)
		t.Logf("local API sample with 1,001 subscriptions: %s %s", path, elapsed)
		if elapsed >= 2*time.Second {
			t.Error(fmt.Sprintf("%s exceeded the PDF two-second target in this local sample: %s", path, elapsed))
		}
	}
}

func registrationCredentials(v Object) Object {
	return Object{"email": v["email"], "password": v["password"]}
}
