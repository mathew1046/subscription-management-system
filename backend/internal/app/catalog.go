package app

import (
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
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
	"customers": "name email address", "quotation-templates": "name plan_id valid_days lines",
}

func validateResource(kind string, v Object) Object {
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
		require(exists, 400, "VALIDATION", "Missing field: "+k)
		if value == nil {
			require(k == "available_until" || kind == "discounts" && k == "product_id", 400, "VALIDATION", "Field cannot be null: "+k)
			continue
		}
		switch k {
		case "archived", "auto_close", "allow_close", "allow_pause", "allow_renew":
			_, ok := value.(bool)
			require(ok, 400, "VALIDATION", "Expected boolean: "+k)
		case "min_quantity", "valid_days", "max_uses":
			f, ok := value.(float64)
			require(ok && f >= 1 && f <= 10000000 && f == float64(int(f)), 400, "VALIDATION", "Invalid integer: "+k)
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
		case "product_id", "plan_id":
			validID(str(value))
		case "lines":
			encoded, e := json.Marshal(value)
			check(e)
			var lines []LineInput
			require(json.Unmarshal(encoded, &lines) == nil, 400, "VALIDATION", "Invalid quotation lines.")
			validateLines(lines)
		default:
			s, ok := value.(string)
			require(ok && len(s) <= 4000, 400, "VALIDATION", "Invalid text: "+k)
			if k != "notes" && k != "address" {
				require(len(strings.TrimSpace(s)) > 0 && len(s) <= 200, 400, "VALIDATION", "Required text: "+k)
			}
		}
	}
	if kind == "plans" {
		require(strings.Contains("|daily|weekly|monthly|yearly|", "|"+str(v["cadence"])+"|"), 400, "VALIDATION", "Invalid cadence.")
		require(v["available_until"] == nil || str(v["available_until"]) >= str(v["available_from"]), 400, "VALIDATION", "Invalid availability dates.")
	}
	if kind == "customers" {
		v["email"] = cleanEmail(str(v["email"]))
	}
	if kind == "discounts" {
		require(v["kind"] == "fixed" || v["kind"] == "percentage", 400, "VALIDATION", "Invalid discount kind.")
		require(str(v["ends_on"]) >= str(v["starts_on"]), 400, "VALIDATION", "Invalid discount dates.")
		require(v["kind"] != "percentage" || number(v["value"]).LessThanOrEqual(decimal.NewFromInt(100)), 400, "VALIDATION", "Percentage exceeds 100.")
	}
	return v
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
	if kind != "customers" && kind != "quotation-templates" {
		administrator(u)
	}
	v := validateResource(kind, body[Object](w, r))
	recordID := r.PathValue("id")
	if r.Method == "PUT" {
		validID(recordID)
	}
	return a.tx(ctx, func(tx pgx.Tx) any {
		if kind == "quotation-templates" {
			encoded, _ := json.Marshal(v["lines"])
			var lines []LineInput
			require(json.Unmarshal(encoded, &lines) == nil, 400, "VALIDATION", "Invalid quotation lines.")
			for _, line := range lines {
				resolveLine(ctx, tx, line)
			}
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
