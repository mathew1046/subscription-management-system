package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
)

var uuidRE = regexp.MustCompile(`^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$`)
var tokenRE = regexp.MustCompile(`^[a-f0-9]{64}$`)
var emailRE = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
var moneyRE = regexp.MustCompile(`^\d{1,12}(\.\d{1,2})?$`)

func validID(s string)             { require(uuidRE.MatchString(s), 400, "VALIDATION", "Invalid identifier.") }
func number(v any) decimal.Decimal { d, e := decimal.NewFromString(str(v)); check(e); return d }
func money(s string) {
	require(moneyRE.MatchString(s), 400, "VALIDATION", "Use a nonnegative decimal string with up to two decimal places.")
}
func pagination(r *http.Request) (int, int) {
	page, size := 1, 25
	var err error
	if s := r.URL.Query().Get("page"); s != "" {
		page, err = strconv.Atoi(s)
		require(err == nil, 400, "VALIDATION", "Invalid page.")
	}
	if s := r.URL.Query().Get("page_size"); s != "" {
		size, err = strconv.Atoi(s)
		require(err == nil, 400, "VALIDATION", "Invalid page size.")
	}
	require(page >= 1 && page <= 100000 && size >= 1 && size <= 100, 400, "VALIDATION", "Invalid pagination.")
	return page, size
}
func paged(items []Object, page, size int) Object {
	more := len(items) > size
	if more {
		items = items[:size]
	}
	return Object{"items": items, "page": page, "page_size": size, "has_more": more}
}

var resourceTables = map[string]string{"products": "products", "variants": "variants", "plans": "plans", "taxes": "taxes", "discounts": "discounts", "customers": "customers", "quotation-templates": "quotation_templates"}
var fields = map[string]string{
	"products": "name type sale_price cost_price notes archived", "variants": "product_id name price_delta",
	"plans": "name price cadence min_quantity available_from available_until auto_close allow_close allow_pause allow_renew",
	"taxes": "name rate", "discounts": "name kind value min_purchase min_quantity starts_on ends_on max_uses product_id",
	"customers": "name email address user_id", "quotation-templates": "name plan_id valid_days lines",
}

func quotationLines(value any) []LineInput {
	encoded, err := json.Marshal(value)
	check(err)
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.DisallowUnknownFields()
	var lines []LineInput
	require(decoder.Decode(&lines) == nil && decoder.Decode(new(any)) == io.EOF, 400, "VALIDATION", "Invalid quotation lines.")
	validateLines(lines)
	return lines
}

func validateResource(kind string, v Object) Object {
	require(v != nil, 400, "VALIDATION", "Expected a resource object.")
	allowed := strings.Fields(fields[kind])
	for k := range v {
		ok := false
		for _, f := range allowed {
			ok = ok || f == k
		}
		require(ok, 400, "VALIDATION", "Unknown field: "+k)
	}
	defaults := map[string]Object{"products": {"notes": "", "archived": false}, "variants": {"price_delta": "0"}, "plans": {"available_until": nil, "auto_close": true, "allow_close": true, "allow_pause": false, "allow_renew": true}, "customers": {"address": ""}, "discounts": {"min_purchase": "0", "min_quantity": float64(1), "product_id": nil}}
	for k, d := range defaults[kind] {
		if _, ok := v[k]; !ok {
			v[k] = d
		}
	}
	for _, k := range allowed {
		value, exists := v[k]
		// Omission preserves a customer's existing account link on PUT.
		if kind == "customers" && k == "user_id" && !exists {
			continue
		}
		require(exists, 400, "VALIDATION", "Missing field: "+k)
		if value == nil {
			require(k == "available_until" || kind == "discounts" && k == "product_id" || kind == "customers" && k == "user_id", 400, "VALIDATION", "Field cannot be null: "+k)
			continue
		}
		switch k {
		case "archived", "auto_close", "allow_close", "allow_pause", "allow_renew":
			_, ok := value.(bool)
			require(ok, 400, "VALIDATION", "Expected boolean: "+k)
		case "min_quantity", "valid_days", "max_uses":
			f, ok := value.(float64)
			maximum := float64(10000000)
			if kind == "plans" && k == "min_quantity" {
				maximum = 100000
			}
			if k == "valid_days" {
				maximum = 365
			}
			require(ok && f >= 1 && f <= maximum && f == float64(int(f)), 400, "VALIDATION", "Invalid integer: "+k)
		case "sale_price", "cost_price", "price_delta", "price", "value", "min_purchase":
			s, ok := value.(string)
			require(ok, 400, "VALIDATION", "Amounts must be strings.")
			money(s)
		case "rate":
			s, ok := value.(string)
			require(ok && regexp.MustCompile(`^\d{1,3}(\.\d{1,4})?$`).MatchString(s), 400, "VALIDATION", "Invalid tax rate.")
			require(number(s).LessThanOrEqual(decimal.NewFromInt(100)), 400, "VALIDATION", "Tax rate exceeds 100.")
		case "available_from", "available_until", "starts_on", "ends_on":
			parseDate(str(value))
		case "product_id", "plan_id", "user_id":
			s, ok := value.(string)
			require(ok, 400, "VALIDATION", "Expected identifier: "+k)
			validID(s)
		case "email":
			s, ok := value.(string)
			require(ok, 400, "VALIDATION", "Invalid email.")
			v[k] = cleanEmail(s)
		case "lines":
			quotationLines(value)
		default:
			s, ok := value.(string)
			require(ok && len(s) <= 4000 && !strings.ContainsRune(s, '\x00'), 400, "VALIDATION", "Invalid text: "+k)
			if k != "notes" && k != "address" {
				require(len(strings.TrimSpace(s)) > 0 && len(s) <= 200, 400, "VALIDATION", "Required text: "+k)
				v[k] = strings.TrimSpace(s)
			}
			if k == "address" {
				require(len(s) <= 2000, 400, "VALIDATION", "Address exceeds 2000 characters.")
			}
		}
	}
	if kind == "plans" {
		cadence := v["cadence"]
		require(cadence == "daily" || cadence == "weekly" || cadence == "monthly" || cadence == "yearly", 400, "VALIDATION", "Invalid cadence.")
		require(v["available_until"] == nil || str(v["available_until"]) >= str(v["available_from"]), 400, "VALIDATION", "Invalid availability dates.")
	}
	if kind == "discounts" {
		require(v["kind"] == "fixed" || v["kind"] == "percentage", 400, "VALIDATION", "Invalid discount kind.")
		require(str(v["ends_on"]) >= str(v["starts_on"]), 400, "VALIDATION", "Invalid discount dates.")
		require(v["kind"] != "percentage" || number(v["value"]).LessThanOrEqual(decimal.NewFromInt(100)), 400, "VALIDATION", "Percentage exceeds 100.")
	}
	return v
}

func linkCustomer(ctx context.Context, tx pgx.Tx, recordID string, userID any) {
	if userID == nil {
		return
	}
	account := one(ctx, tx, "SELECT role FROM users WHERE id=$1 FOR UPDATE", userID)
	require(account["role"] == "customer", 400, "VALIDATION", "Only customer accounts can be linked.")
	if recordID != "" {
		target := one(ctx, tx, "SELECT user_id FROM customers WHERE id=$1 FOR UPDATE", recordID)
		owner := str(target["user_id"])
		require(owner == "" || strings.EqualFold(owner, str(userID)), 409, "ACCOUNT_LINKED", "Customer already belongs to another account.")
	}
	// Signup creates an empty portal profile. An admin may move that account
	// onto an existing customer, but never take ownership of another history.
	linked := rows(ctx, tx, "SELECT id FROM customers WHERE user_id=$1 AND id IS DISTINCT FROM NULLIF($2::text,'')::uuid FOR UPDATE", userID, recordID)
	for _, previous := range linked {
		used := one(ctx, tx, "SELECT EXISTS(SELECT 1 FROM subscriptions WHERE customer_id=$1) OR EXISTS(SELECT 1 FROM invoices WHERE customer_id=$1) AS used", previous["id"])
		require(!truth(used["used"]), 409, "ACCOUNT_LINKED", "Account already owns customer history; retain its existing customer record.")
		exec(ctx, tx, "UPDATE customers SET user_id=NULL WHERE id=$1", previous["id"])
	}
}

func (a *App) catalog(w http.ResponseWriter, r *http.Request) any {
	u := a.user(r)
	kind := r.PathValue("resource")
	table, ok := resourceTables[kind]
	require(ok, 404, "NOT_FOUND", "Unknown resource.")
	internal(u)

	ctx := r.Context()
	if r.Method == "GET" {
		page, size := pagination(r)
		return paged(rows(ctx, a.DB, "SELECT * FROM "+table+" ORDER BY id LIMIT $1 OFFSET $2", size+1, (page-1)*size), page, size)
	}
	if kind != "customers" {
		administrator(u)
	}
	v := validateResource(kind, body[Object](w, r))
	if _, linking := v["user_id"]; linking {
		administrator(u)
	}
	recordID := r.PathValue("id")
	if r.Method == "PUT" {
		validID(recordID)
	}
	return a.tx(ctx, func(tx pgx.Tx) any {
		if kind == "customers" {
			if userID, linking := v["user_id"]; linking {
				linkCustomer(ctx, tx, recordID, userID)
			}
		}
		if kind == "discounts" && recordID != "" {
			existing := one(ctx, tx, "SELECT uses FROM discounts WHERE id=$1 FOR UPDATE", recordID)
			require(number(v["max_uses"]).GreaterThanOrEqual(number(existing["uses"])), 400, "VALIDATION", "Usage cap cannot be less than consumed uses.")
		}
		if kind == "variants" || kind == "discounts" && v["product_id"] != nil {
			one(ctx, tx, "SELECT id FROM products WHERE id=$1 AND archived=false FOR SHARE", v["product_id"])
		}
		if kind == "quotation-templates" {
			plan := one(ctx, tx, "SELECT min_quantity FROM plans WHERE id=$1 FOR SHARE", v["plan_id"])
			lines := quotationLines(v["lines"])
			quantity := 0
			for _, line := range lines {
				resolveLine(ctx, tx, line)
				quantity += line.Quantity
			}
			require(quantity >= integer(plan["min_quantity"]), 400, "MINIMUM_QUANTITY", "Template does not meet plan minimum quantity.")
			encoded, err := json.Marshal(lines)
			check(err)
			v["lines"] = encoded
		}
		keys := []string{}
		for k := range v {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		args := []any{}
		bind := []string{}
		sets := []string{}
		for i, k := range keys {
			args = append(args, v[k])
			bind = append(bind, fmt.Sprintf("$%d", i+1))
			sets = append(sets, fmt.Sprintf("%s=$%d", k, i+1))
		}
		sql := "INSERT INTO " + table + "(" + strings.Join(keys, ",") + ") VALUES(" + strings.Join(bind, ",") + ") RETURNING *"
		if recordID != "" {
			args = append(args, recordID)
			sql = "UPDATE " + table + " SET " + strings.Join(sets, ",") + fmt.Sprintf(" WHERE id=$%d RETURNING *", len(args))
		}
		result := one(ctx, tx, sql, args...)
		audit(ctx, tx, u, kind+".save", str(result["id"]))
		return result
	})
}
