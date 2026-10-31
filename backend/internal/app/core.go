package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

type App struct {
	DB        *pgxpool.Pool
	Origin    string
	Currency  string
	Secure    bool
	hashSlots chan struct{}
}
type User struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
	Role  string `json:"role"`
}
type Object = map[string]any
type fault struct {
	Status        int
	Code, Message string
}

func (e fault) Error() string { return e.Message }
func require(ok bool, status int, code, message string) {
	if !ok {
		panic(fault{status, code, message})
	}
}
func check(err error) {
	if err != nil {
		panic(err)
	}
}

type Querier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func rows(ctx context.Context, q Querier, sql string, args ...any) []Object {
	r, err := q.Query(ctx, sql, args...)
	check(err)
	defer r.Close()
	result := []Object{}
	for r.Next() {
		values, err := r.Values()
		check(err)
		obj := Object{}
		for i, f := range r.FieldDescriptions() {
			v := values[i]
			switch n := v.(type) {
			case pgtype.Numeric:
				v, err = n.Value()
				check(err)
			case [16]byte:
				b := hex.EncodeToString(n[:])
				v = b[:8] + "-" + b[8:12] + "-" + b[12:16] + "-" + b[16:20] + "-" + b[20:]
			case time.Time:
				if f.DataTypeOID == 1082 {
					v = n.Format("2006-01-02")
				} else {
					v = n.UTC().Format(time.RFC3339)
				}
			}
			obj[f.Name] = v
		}
		result = append(result, obj)
	}
	check(r.Err())
	return result
}
func one(ctx context.Context, q Querier, sql string, args ...any) Object {
	r := rows(ctx, q, sql, args...)
	require(len(r) > 0, 404, "NOT_FOUND", "Record not found.")
	return r[0]
}
func exec(ctx context.Context, q Querier, sql string, args ...any) {
	_, err := q.Exec(ctx, sql, args...)
	check(err)
}
func (a *App) tx(ctx context.Context, fn func(pgx.Tx) any) any {
	tx, err := a.DB.Begin(ctx)
	check(err)
	defer tx.Rollback(ctx)
	exec(ctx, tx, "SET LOCAL lock_timeout='5s'")
	result := fn(tx)
	check(tx.Commit(ctx))
	return result
}
func str(v any) string {
	if v == nil {
		return ""
	}
	return fmt.Sprint(v)
}
func integer(v any) int { i, err := strconv.Atoi(str(v)); check(err); return i }
func truth(v any) bool  { return v == true }
func token() string {
	b := make([]byte, 32)
	_, err := rand.Read(b)
	check(err)
	return hex.EncodeToString(b)
}
func today() string { return time.Now().UTC().Format("2006-01-02") }
func parseDate(s string) time.Time {
	d, e := time.Parse("2006-01-02", s)
	require(e == nil && d.Format("2006-01-02") == s, 400, "VALIDATION", "Use a valid YYYY-MM-DD date.")
	return d
}
func addDays(s string, n int) string { return parseDate(s).AddDate(0, 0, n).Format("2006-01-02") }
func nextPeriod(s, cadence string, anchor int) string {
	d := parseDate(s)
	switch cadence {
	case "daily":
		return addDays(s, 1)
	case "weekly":
		return addDays(s, 7)
	}
	months := 1
	if cadence == "yearly" {
		months = 12
	}
	first := time.Date(d.Year(), d.Month()+time.Month(months), 1, 0, 0, 0, 0, time.UTC)
	last := first.AddDate(0, 1, -1).Day()
	if anchor > last {
		anchor = last
	}
	return first.AddDate(0, 0, anchor-1).Format("2006-01-02")
}
func body[T any](w http.ResponseWriter, r *http.Request) T {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var v T
	err := decoder.Decode(&v)
	require(err == nil, 400, "VALIDATION", "Invalid JSON body or unknown field.")
	require(decoder.Decode(new(any)) == io.EOF, 400, "VALIDATION", "Only one JSON body is accepted.")
	return v
}
func internal(u User) {
	require(u.Role == "admin" || u.Role == "staff", 403, "FORBIDDEN", "Staff access required.")
}
func administrator(u User) { require(u.Role == "admin", 403, "FORBIDDEN", "Admin access required.") }
func audit(ctx context.Context, q Querier, u User, action, id string) {
	exec(ctx, q, "INSERT INTO audit_events(actor_id,action,resource_id) VALUES($1,$2,$3)", u.ID, action, id)
}
func (a *App) Handle(fn func(http.ResponseWriter, *http.Request) any) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		requestID := token()[:24]
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Request-ID", requestID)
		defer func() {
			if p := recover(); p != nil {
				f := fault{500, "INTERNAL", "Request failed. Contact the team with the request ID."}
				switch e := p.(type) {
				case fault:
					f = e
				case *pgconn.PgError:
					switch e.Code {
					case "23505":
						f = fault{409, "CONFLICT", "A matching record already exists."}
					case "23503", "23514", "22P02", "22003":
						f = fault{400, "VALIDATION", "Invalid data or referenced record."}
					case "55P03", "40P01", "40001":
						f = fault{409, "RETRY", "Concurrent update. Retry the request."}
					}
				}
				if f.Status >= 500 {
					slog.Error("request failed", "request_id", requestID, "kind", fmt.Sprintf("%T", p))
				}
				w.WriteHeader(f.Status)
				_ = json.NewEncoder(w).Encode(Object{"error": Object{"code": f.Code, "message": f.Message}, "request_id": requestID})
			}
		}()
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		r = r.WithContext(ctx)
		if r.Method != "GET" && r.Method != "HEAD" {
			require(r.Header.Get("Origin") == a.Origin, 403, "ORIGIN", "Mutation origin not allowed.")
			require(strings.HasPrefix(r.Header.Get("Content-Type"), "application/json"), 415, "CONTENT_TYPE", "Use application/json.")
		}
		data := fn(w, r)
		_ = json.NewEncoder(w).Encode(Object{"data": data, "request_id": requestID})
	}
}
func New(ctx context.Context) (*App, error) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		return nil, errors.New("DATABASE_URL is required")
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 12
	cfg.ConnConfig.ConnectTimeout = 5 * time.Second
	cfg.ConnConfig.RuntimeParams["statement_timeout"] = "15000"
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err = db.Ping(ctx); err != nil {
		db.Close()
		return nil, err
	}
	origin := os.Getenv("APP_ORIGIN")
	if origin == "" {
		origin = "http://localhost:3000"
	}
	currency := os.Getenv("APP_CURRENCY")
	if currency == "" {
		currency = "INR"
	}
	if len(currency) != 3 {
		db.Close()
		return nil, errors.New("APP_CURRENCY must be an ISO currency code")
	}
	return &App{DB: db, Origin: strings.TrimRight(origin, "/"), Currency: currency, Secure: strings.HasPrefix(origin, "https://"), hashSlots: make(chan struct{}, 4)}, nil
}
