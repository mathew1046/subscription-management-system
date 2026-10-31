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
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
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
	requestFor := func(t *testing.T) func(*http.Client, string, string, any, int) Object {
		return func(client *http.Client, method, path string, input any, status int) Object {
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
	}
	request := requestFor(t)
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
	request(admin, "PUT", "/api/customers/"+customerID, Object{"name": "Renamed customer", "email": registration["email"], "address": ""}, 200)
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
			if p["customer_id"] != customerID || p["customer_name"] != "Customer" || p["invoice_number"] != invoice["number"] || p["currency"] != "INR" {
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
	t.Run("subscription creation request keys", func(t *testing.T) {
		request := requestFor(t)
		product := request(admin, "POST", "/api/products", Object{"name": "Replay product", "type": "software", "sale_price": "12.00", "cost_price": "1.00"}, 200)
		variant := request(admin, "POST", "/api/variants", Object{"name": "Replay variant", "product_id": product["id"], "price_delta": "2.00"}, 200)
		tax := request(admin, "POST", "/api/taxes", Object{"name": "Replay tax", "rate": "5"}, 200)
		plan := request(admin, "POST", "/api/plans", Object{"name": "Replay plan", "price": "3.00", "cadence": "monthly", "min_quantity": 1, "available_from": now, "allow_pause": true, "allow_renew": true, "allow_close": true, "auto_close": true}, 200)
		lines := []Object{
			{"product_id": product["id"], "variant_id": variant["id"], "tax_id": tax["id"], "quantity": 1},
			{"product_id": product["id"], "quantity": 2},
		}
		input := Object{"request_key": "abcdefab-1234-4567-89ab-abcdefabcdef", "customer_id": customerID, "plan_id": plan["id"], "start_date": now, "end_date": end, "quote_valid_until": now, "lines": lines}
		clone := func(v Object) Object {
			b, err := json.Marshal(v)
			if err != nil {
				t.Fatal(err)
			}
			var copy Object
			if err := json.Unmarshal(b, &copy); err != nil {
				t.Fatal(err)
			}
			return copy
		}
		first := request(staff, "POST", "/api/subscriptions", input, 200)
		firstDetail := request(staff, "GET", "/api/subscriptions/"+str(first["id"]), nil, 200)
		replay := request(staff, "POST", "/api/subscriptions", input, 200)
		if !reflect.DeepEqual(first, replay) {
			t.Fatal("exact creation replay changed the subscription")
		}
		normalized := clone(input)
		for _, field := range []string{"request_key", "customer_id", "plan_id"} {
			normalized[field] = strings.ToUpper(str(normalized[field]))
		}
		for _, item := range normalized["lines"].([]any) {
			line := item.(map[string]any)
			for _, field := range []string{"product_id", "variant_id", "tax_id"} {
				if line[field] != nil {
					line[field] = strings.ToUpper(str(line[field]))
				}
			}
		}
		normalized["payment_terms_days"] = 14
		if got := request(staff, "POST", "/api/subscriptions", normalized, 200); !reflect.DeepEqual(first, got) {
			t.Fatal("UUID case/default terms changed canonical replay")
		}
		// Every accepted input field participates, including line order and
		// nullable variant/tax IDs; mismatches never revalidate the catalog.
		for _, field := range []string{"customer_id", "plan_id", "start_date", "end_date", "quote_valid_until", "payment_terms_days", "product_id", "variant_id", "tax_id", "quantity", "line_order"} {
			changed := clone(input)
			line := changed["lines"].([]any)[0].(map[string]any)
			switch field {
			case "customer_id", "plan_id":
				changed[field] = "99999999-9999-4999-8999-999999999999"
			case "start_date":
				changed[field] = addDays(now, 1)
			case "end_date":
				changed[field] = addDays(end, 1)
			case "quote_valid_until":
				changed[field] = addDays(now, 1)
			case "payment_terms_days":
				changed[field] = 0
			case "product_id":
				line[field] = "99999999-9999-4999-8999-999999999999"
			case "variant_id", "tax_id":
				line[field] = nil
			case "quantity":
				line[field] = 2
			case "line_order":
				items := changed["lines"].([]any)
				items[0], items[1] = items[1], items[0]
			}
			if got := request(staff, "POST", "/api/subscriptions", changed, 409); got["code"] != "CONFLICT" {
				t.Fatalf("%s mismatch returned %v", field, got)
			}
		}
		actorScoped := request(admin, "POST", "/api/subscriptions", input, 200)
		if actorScoped["id"] == first["id"] {
			t.Fatal("different actors shared a creation key")
		}
		request(customer, "POST", "/api/subscriptions", input, 403)
		invalid := clone(input)
		invalid["request_key"] = "invalid"
		request(staff, "POST", "/api/subscriptions", invalid, 400)
		invalid = clone(input)
		invalid["lines"].([]any)[0].(map[string]any)["quantity"] = 0
		request(staff, "POST", "/api/subscriptions", invalid, 400)
		legacy := clone(input)
		delete(legacy, "request_key")
		legacyFirst := request(staff, "POST", "/api/subscriptions", legacy, 200)
		if got := request(staff, "POST", "/api/subscriptions", legacy, 200); got["id"] == legacyFirst["id"] {
			t.Fatal("unkeyed creation unexpectedly became idempotent")
		}
		zeroTerms := clone(input)
		zeroTerms["request_key"] = "33333333-3333-4333-8333-333333333333"
		zeroTerms["payment_terms_days"] = 0
		if got := request(staff, "POST", "/api/subscriptions", zeroTerms, 200); integer(got["payment_terms_days"]) != 0 {
			t.Fatal("explicit zero payment terms were replaced with the default")
		}
		delete(zeroTerms, "payment_terms_days")
		request(staff, "POST", "/api/subscriptions", zeroTerms, 409)
		// Failed validation must roll back even the early key reservation.
		invalid = clone(input)
		invalid["request_key"] = "44444444-4444-4444-8444-444444444444"
		invalid["lines"].([]any)[0].(map[string]any)["variant_id"] = "99999999-9999-4999-8999-999999999999"
		before := one(ctx, a.DB, "SELECT (SELECT count(*) FROM subscriptions) AS subscriptions,(SELECT count(*) FROM subscription_lines) AS lines,(SELECT count(*) FROM audit_events WHERE action='subscription.create') AS audits")
		request(staff, "POST", "/api/subscriptions", invalid, 404)
		after := one(ctx, a.DB, "SELECT (SELECT count(*) FROM subscriptions) AS subscriptions,(SELECT count(*) FROM subscription_lines) AS lines,(SELECT count(*) FROM audit_events WHERE action='subscription.create') AS audits")
		if !reflect.DeepEqual(before, after) || integer(one(ctx, a.DB, "SELECT count(*) AS count FROM subscription_create_requests WHERE request_key=$1", invalid["request_key"])["count"]) != 0 {
			t.Fatal("failed creation left subscription/lines/audit/key state")
		}
		invalid["lines"] = lines
		request(staff, "POST", "/api/subscriptions", invalid, 200)

		concurrent := clone(input)
		concurrent["request_key"] = "55555555-5555-4555-8555-555555555555"
		encoded, err := json.Marshal(concurrent)
		if err != nil {
			t.Fatal(err)
		}
		// Hold INSERTs but permit the initial lookups: both transactions must
		// establish their RR snapshots before either reservation can win.
		blocker, err := a.DB.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer blocker.Rollback(ctx)
		exec(ctx, blocker, "LOCK TABLE subscription_create_requests IN SHARE MODE")
		type creationResult struct {
			data Object
			err  error
		}
		results := make(chan creationResult, 2)
		for range 2 {
			go func() {
				r, err := http.NewRequestWithContext(ctx, "POST", server.URL+"/api/subscriptions", bytes.NewReader(encoded))
				if err != nil {
					results <- creationResult{err: err}
					return
				}
				r.Header.Set("Origin", server.URL)
				r.Header.Set("Content-Type", "application/json")
				response, err := staff.Do(r)
				if err != nil {
					results <- creationResult{err: err}
					return
				}
				defer response.Body.Close()
				var envelope Object
				if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
					results <- creationResult{err: err}
					return
				}
				if response.StatusCode != 200 {
					results <- creationResult{err: fmt.Errorf("concurrent creation status %d: %v", response.StatusCode, envelope)}
					return
				}
				results <- creationResult{data: envelope["data"].(map[string]any)}
			}()
		}
		bothWaiting := false
		deadline := time.Now().Add(2 * time.Second)
		for time.Now().Before(deadline) {
			waiting := one(ctx, a.DB, `SELECT count(*) AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'INSERT INTO subscription_create_requests%'`)
			if integer(waiting["count"]) == 2 {
				bothWaiting = true
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
		if err := blocker.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		var winner Object
		for range 2 {
			got := <-results
			if got.err != nil {
				t.Fatal(got.err)
			}
			if winner != nil && !reflect.DeepEqual(winner, got.data) {
				t.Fatal("concurrent creation returned different subscriptions")
			}
			winner = got.data
		}
		if !bothWaiting {
			t.Fatal("concurrent requests did not both establish snapshots before the reservation race")
		}
		counts := one(ctx, a.DB, `SELECT count(*) AS requests,count(DISTINCT s.id) AS subscriptions,(SELECT count(*) FROM subscription_lines WHERE subscription_id=$2) AS lines,(SELECT count(*) FROM audit_events WHERE action='subscription.create' AND resource_id=$2) AS audits FROM subscription_create_requests r JOIN subscriptions s ON s.id=r.subscription_id WHERE r.request_key=$1`, concurrent["request_key"], winner["id"])
		if integer(counts["requests"]) != 1 || integer(counts["subscriptions"]) != 1 || integer(counts["lines"]) != len(lines) || integer(counts["audits"]) != 1 {
			t.Fatalf("concurrent creation was not atomic and unique: %v", counts)
		}

		// Changed catalog rules and prices cannot affect an already committed
		// request, even when a fresh creation would now be rejected.
		exec(ctx, a.DB, "UPDATE products SET archived=true,sale_price=999 WHERE id=$1", product["id"])
		exec(ctx, a.DB, "UPDATE variants SET price_delta=999 WHERE id=$1", variant["id"])
		exec(ctx, a.DB, "UPDATE taxes SET rate=99 WHERE id=$1", tax["id"])
		exec(ctx, a.DB, "UPDATE plans SET available_from=$2,price=999,min_quantity=100 WHERE id=$1", plan["id"], addDays(now, 1))
		if got := request(staff, "POST", "/api/subscriptions", input, 200); !reflect.DeepEqual(first, got) {
			t.Fatal("catalog changes affected replay")
		}
		if got := request(staff, "GET", "/api/subscriptions/"+str(first["id"]), nil, 200); !reflect.DeepEqual(firstDetail, got) {
			t.Fatal("replay changed the original line prices, taxes or quote totals")
		}
		fresh := clone(input)
		fresh["request_key"] = "66666666-6666-4666-8666-666666666666"
		request(staff, "POST", "/api/subscriptions", fresh, 400)

		// Seed a committed historical request in this disposable DB rather
		// than changing the process clock or rewriting any stored payload.
		historical := clone(input)
		historical["request_key"] = "77777777-7777-4777-8777-777777777777"
		historical["start_date"] = addDays(now, -2)
		historical["end_date"] = addDays(now, -1)
		historical["quote_valid_until"] = addDays(now, -2)
		historical["payment_terms_days"] = 14
		payloadInput := clone(historical)
		delete(payloadInput, "request_key")
		// Null/omitted optional line IDs have one canonical representation.
		payloadInput["lines"].([]any)[1].(map[string]any)["variant_id"] = nil
		payloadInput["lines"].([]any)[1].(map[string]any)["tax_id"] = nil
		payload, err := json.Marshal(payloadInput)
		if err != nil {
			t.Fatal(err)
		}
		historicalSub := a.tx(ctx, func(tx pgx.Tx) any {
			s := one(ctx, tx, `INSERT INTO subscriptions(customer_id,plan_id,start_date,end_date,quote_valid_until,next_billing_date,anchor_day,currency,plan_snapshot,billing_anchor) SELECT customer_id,plan_id,$2,$3,$2,$2,EXTRACT(DAY FROM $2::date)::integer,currency,plan_snapshot,$2 FROM subscriptions WHERE id=$1 RETURNING *`, first["id"], historical["start_date"], historical["end_date"])
			exec(ctx, tx, `INSERT INTO subscription_lines(subscription_id,product_id,variant_id,description,quantity,unit_price,tax_rate) SELECT $2,product_id,variant_id,description,quantity,unit_price,tax_rate FROM subscription_lines WHERE subscription_id=$1`, first["id"], s["id"])
			exec(ctx, tx, `INSERT INTO subscription_create_requests(actor_id,request_key,payload,subscription_id) SELECT actor_id,$2,$3,$4 FROM subscription_create_requests WHERE subscription_id=$1`, first["id"], historical["request_key"], payload, s["id"])
			exec(ctx, tx, `INSERT INTO audit_events(actor_id,action,resource_id) SELECT actor_id,'subscription.create',$2 FROM subscription_create_requests WHERE subscription_id=$1`, first["id"], s["id"])
			return s
		}).(Object)
		if got := request(staff, "POST", "/api/subscriptions", historical, 200); got["id"] != historicalSub["id"] || got["end_date"] != historical["end_date"] || !reflect.DeepEqual(first["plan_snapshot"], got["plan_snapshot"]) {
			t.Fatal("expired historical request did not replay its original subscription")
		}
		delete(historical, "request_key")
		request(staff, "POST", "/api/subscriptions", historical, 400)
	})
	t.Run("shared rate limits and expiry", func(t *testing.T) {
		request := requestFor(t)
		input := Registration{Name: "Rate fixture", Email: "rate@example.test", Password: password}
		account := a.register(ctx, input, "customer")
		first, second := newClient(), newClient()
		for _, client := range []*http.Client{first, second} {
			request(client, "POST", "/api/auth/login", Object{"email": input.Email, "password": password}, 200)
		}
		// A second application instance shares only PostgreSQL, not limiter state.
		peer := *a
		peerServer := httptest.NewServer(peer.Routes())
		defer peerServer.Close()
		readKey, _ := userRatePolicy(str(account["id"]), http.MethodGet)
		writeKey, _ := userRatePolicy(str(account["id"]), http.MethodPost)
		seed := func(key string, hits int, seconds int) {
			exec(ctx, a.DB, `INSERT INTO rate_limits(key,hits,expires_at) VALUES($1,$2,now()+$3::integer*interval '1 second') ON CONFLICT(key) DO UPDATE SET hits=EXCLUDED.hits,expires_at=EXCLUDED.expires_at`, digest(key), hits, seconds)
		}
		seed(readKey, userReadRateLimit-1, 60)
		request(first, "GET", "/api/auth/me", nil, 200)
		response, err := second.Get(peerServer.URL + "/api/auth/me")
		if err != nil {
			t.Fatal(err)
		}
		io.Copy(io.Discard, response.Body)
		response.Body.Close()
		seconds, err := strconv.Atoi(response.Header.Get("Retry-After"))
		if response.StatusCode != 429 || err != nil || seconds < 1 || seconds > 60 {
			t.Fatalf("shared read limit: status=%d Retry-After=%q", response.StatusCode, response.Header.Get("Retry-After"))
		}
		request(admin, "GET", "/api/auth/me", nil, 200)
		seed(writeKey, userMutationRateLimit-1, 60)
		// The independent write budget admits this request to authorization.
		request(first, "POST", "/api/billing/run", Object{}, 403)
		if got := request(second, "POST", "/api/billing/run", Object{}, 429); got["code"] != "RATE_LIMIT" {
			t.Fatal("mutation budget did not return the existing rate-limit envelope")
		}
		exec(ctx, a.DB, "UPDATE rate_limits SET expires_at=now()-interval '1 second' WHERE key=$1", digest(readKey))
		request(second, "GET", "/api/auth/me", nil, 200)
		if integer(one(ctx, a.DB, "SELECT hits FROM rate_limits WHERE key=$1", digest(readKey))["hits"]) != 1 {
			t.Fatal("expired read window did not restart at one")
		}
		seed("auth-global", 500, 900)
		defer exec(ctx, a.DB, "DELETE FROM rate_limits WHERE key=$1", digest("auth-global"))
		request(first, "POST", "/api/auth/logout", Object{}, 200)
		request(first, "GET", "/api/auth/me", nil, 401)
		request(second, "POST", "/api/billing/run", Object{}, 429)

		const key = "integration:atomic-rate-window"
		results := make(chan any, 8)
		for i := range 8 {
			go func() {
				var failure any
				func() {
					defer func() { failure = recover() }()
					instance := a
					if i%2 == 1 {
						instance = &peer
					}
					instance.rateWindow(ctx, key, 3, time.Minute)
				}()
				results <- failure
			}()
		}
		accepted := 0
		for range 8 {
			failure := <-results
			if failure == nil {
				accepted++
				continue
			}
			if _, ok := failure.(rateLimitFault); !ok {
				t.Fatalf("unexpected limiter failure: %v", failure)
			}
		}
		if accepted != 3 {
			t.Fatalf("atomic limiter admitted %d requests, want 3", accepted)
		}
	})
	// A bounded local API sample, not proof of every frontend page or load SLA.
	exec(ctx, a.DB, `INSERT INTO subscriptions(customer_id,plan_id,status,start_date,end_date,quote_valid_until,next_billing_date,anchor_day,currency,plan_snapshot,billing_anchor)
		SELECT $1,$2,'Active',$3::date,$4::date,$3::date,$3::date+1,EXTRACT(DAY FROM $3::date)::integer,'INR',$5,$3::date FROM generate_series(1,1000)`, customerID, plan["id"], now, end, plan)
	sampleCount := integer(one(ctx, a.DB, "SELECT count(*) AS count FROM subscriptions")["count"])
	for _, path := range []string{"/api/subscriptions?page_size=100", "/api/invoices?page_size=100", "/api/reports"} {
		started := time.Now()
		request(admin, "GET", path, nil, 200)
		elapsed := time.Since(started)
		t.Logf("local API sample with %d subscriptions: %s %s", sampleCount, path, elapsed)
		if elapsed >= 2*time.Second {
			t.Error(fmt.Sprintf("%s exceeded the PDF two-second target in this local sample: %s", path, elapsed))
		}
	}
}

func registrationCredentials(v Object) Object {
	return Object{"email": v["email"], "password": v["password"]}
}
