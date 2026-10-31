package app

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/mail"
	"os"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/argon2"
)

const sessionCookie = "brightloop_session"

func digest(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }
func validatePassword(s string) {
	upper, lower, special := false, false, false
	for _, c := range s {
		upper = upper || unicode.IsUpper(c)
		lower = lower || unicode.IsLower(c)
		special = special || (!unicode.IsLetter(c) && !unicode.IsDigit(c) && !unicode.IsSpace(c))
	}
	require(utf8.ValidString(s) && len([]rune(s)) >= 9 && len(s) <= 128 && upper && lower && special, 400, "PASSWORD_POLICY", "Password needs at least 9 characters, uppercase, lowercase and a special character.")
}
func (a *App) hashPassword(ctx context.Context, password string) string {
	select {
	case a.hashSlots <- struct{}{}:
	case <-ctx.Done():
		panic(ctx.Err())
	}
	defer func() { <-a.hashSlots }()
	salt := token()[:32]
	hash := argon2.IDKey([]byte(password), []byte(salt), 2, 64*1024, 2, 32)
	return "argon2id$" + salt + "$" + hex.EncodeToString(hash)
}
func (a *App) verify(ctx context.Context, password, hash string) bool {
	parts := strings.Split(hash, "$")
	if len(parts) != 3 || parts[0] != "argon2id" || len(parts[1]) != 32 || len(parts[2]) != 64 {
		return false
	}
	expected, e := hex.DecodeString(parts[2])
	if e != nil {
		return false
	}
	select {
	case a.hashSlots <- struct{}{}:
	case <-ctx.Done():
		panic(ctx.Err())
	}
	defer func() { <-a.hashSlots }()
	actual := argon2.IDKey([]byte(password), []byte(parts[1]), 2, 64*1024, 2, 32)
	return subtle.ConstantTimeCompare(actual, expected) == 1
}
func (a *App) rate(ctx context.Context, key string, limit int) {
	r := one(ctx, a.DB, `INSERT INTO rate_limits(key,hits,expires_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.hits+1 END,expires_at=CASE WHEN rate_limits.expires_at<now() THEN now()+interval '15 minutes' ELSE rate_limits.expires_at END RETURNING hits`, digest(key))
	require(integer(r["hits"]) <= limit, 429, "RATE_LIMIT", "Too many attempts. Try again later.")
}
func (a *App) user(r *http.Request) User {
	cookie, err := r.Cookie(sessionCookie)
	require(err == nil && tokenRE.MatchString(cookie.Value), 401, "UNAUTHENTICATED", "Sign in to continue.")
	var u User
	err = a.DB.QueryRow(r.Context(), `SELECT u.id::text,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`, digest(cookie.Value)).Scan(&u.ID, &u.Name, &u.Email, &u.Role)
	require(err != pgx.ErrNoRows, 401, "UNAUTHENTICATED", "Session expired. Sign in again.")
	check(err)
	return u
}
func (a *App) setCookie(w http.ResponseWriter, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: value, Path: "/", HttpOnly: true, Secure: a.Secure, SameSite: http.SameSiteLaxMode, MaxAge: maxAge})
}

type Credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}
type Registration struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

func cleanEmail(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	require(emailRE.MatchString(s) && len(s) <= 254, 400, "VALIDATION", "Invalid email.")
	address, err := mail.ParseAddress(s)
	require(err == nil && address.Address == s, 400, "VALIDATION", "Invalid email.")
	return s
}
func (a *App) register(ctx context.Context, input Registration, role string) Object {
	require(role == "customer" || role == "staff" || role == "admin", 400, "VALIDATION", "Invalid account role.")
	input.Email = cleanEmail(input.Email)
	validatePassword(input.Password)
	input.Name = strings.TrimSpace(input.Name)
	require(len(input.Name) > 0 && len(input.Name) <= 200 && !strings.ContainsRune(input.Name, '\x00'), 400, "VALIDATION", "Name required.")
	a.rate(ctx, "signup:"+input.Email, 5)
	hash := a.hashPassword(ctx, input.Password)
	return a.tx(ctx, func(tx pgx.Tx) any {
		u := one(ctx, tx, "INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role", input.Name, input.Email, hash, role)
		if role == "customer" {
			exec(ctx, tx, "INSERT INTO customers(user_id,name,email) VALUES($1,$2,$3)", u["id"], input.Name, input.Email)
		}
		return u
	}).(Object)
}
func (a *App) auth(w http.ResponseWriter, r *http.Request) any {
	ctx := r.Context()
	action := r.PathValue("action")
	if r.Method == "GET" {
		require(action == "me", 404, "NOT_FOUND", "Unknown endpoint.")
		return a.user(r)
	}
	a.rate(ctx, "auth-global", 500)
	switch action {
	case "signup":
		return a.register(ctx, body[Registration](w, r), "customer")
	case "login":
		v := body[Credentials](w, r)
		v.Email = cleanEmail(v.Email)
		require(len(v.Password) <= 128, 400, "VALIDATION", "Invalid credentials.")
		a.rate(ctx, "login:"+v.Email, 15)
		found := rows(ctx, a.DB, "SELECT id,name,email,role,password_hash FROM users WHERE email=$1", v.Email)
		hash := "argon2id$" + strings.Repeat("0", 32) + "$" + strings.Repeat("0", 64)
		if len(found) > 0 {
			hash = str(found[0]["password_hash"])
		}
		valid := a.verify(ctx, v.Password, hash)
		require(valid && len(found) > 0, 401, "INVALID_CREDENTIALS", "Invalid email or password.")
		u := found[0]
		delete(u, "password_hash")
		t := token()
		a.tx(ctx, func(tx pgx.Tx) any {
			// Serialize session issuance with resets; a password checked before a
			// concurrent reset must not create a session after revocation.
			current := one(ctx, tx, "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE", u["id"])
			require(str(current["password_hash"]) == hash, 401, "INVALID_CREDENTIALS", "Invalid email or password.")
			exec(ctx, tx, "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')", digest(t), u["id"])
			return nil
		})
		a.setCookie(w, t, 7*86400)
		return u
	case "logout":
		if c, e := r.Cookie(sessionCookie); e == nil {
			exec(ctx, a.DB, "DELETE FROM sessions WHERE token_hash=$1", digest(c.Value))
		}
		a.setCookie(w, "", -1)
		return Object{"ok": true}
	case "forgot-password":
		v := body[struct {
			Email string `json:"email"`
		}](w, r)
		email := cleanEmail(v.Email)
		a.rate(ctx, "reset:"+email, 5)
		a.tx(ctx, func(tx pgx.Tx) any {
			found := rows(ctx, tx, "SELECT id FROM users WHERE email=$1 FOR UPDATE", email)
			if len(found) == 0 {
				return nil
			}
			t := token()
			exec(ctx, tx, "DELETE FROM password_resets WHERE user_id=$1", found[0]["id"])
			exec(ctx, tx, "INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 minutes')", digest(t), found[0]["id"])
			exec(ctx, tx, "INSERT INTO outbox(recipient,subject,body) VALUES($1,$2,$3)", email, "Reset your Brightloop password", "Open within 30 minutes: "+a.Origin+"/reset-password?token="+t)
			return nil
		})
		return Object{"ok": true}
	case "reset-password":
		v := body[struct {
			Token    string `json:"token"`
			Password string `json:"password"`
		}](w, r)
		require(tokenRE.MatchString(v.Token), 400, "INVALID_TOKEN", "Invalid reset link.")
		validatePassword(v.Password)
		found := rows(ctx, a.DB, "SELECT user_id FROM password_resets WHERE token_hash=$1 AND expires_at>now()", digest(v.Token))
		require(len(found) > 0, 400, "INVALID_TOKEN", "Invalid or expired reset link.")
		hash := a.hashPassword(ctx, v.Password)
		a.tx(ctx, func(tx pgx.Tx) any {
			// All credential mutations lock the user first, avoiding a user/reset
			// lock inversion with forgot-password and concurrent session issuance.
			u := found[0]["user_id"]
			one(ctx, tx, "SELECT id FROM users WHERE id=$1 FOR UPDATE", u)
			matches := rows(ctx, tx, "SELECT * FROM password_resets WHERE token_hash=$1 AND expires_at>now() FOR UPDATE", digest(v.Token))
			require(len(matches) > 0, 400, "INVALID_TOKEN", "Invalid or expired reset link.")
			exec(ctx, tx, "UPDATE users SET password_hash=$1 WHERE id=$2", hash, u)
			exec(ctx, tx, "DELETE FROM sessions WHERE user_id=$1", u)
			exec(ctx, tx, "DELETE FROM password_resets WHERE user_id=$1", u)
			return nil
		})
		a.setCookie(w, "", -1)
		return Object{"ok": true}
	}
	panic(fault{404, "NOT_FOUND", "Unknown auth action."})
}
func (a *App) CreateAdmin(ctx context.Context) (err error) {
	defer func() {
		if p := recover(); p != nil {
			err = fmt.Errorf("admin creation: %v", p)
		}
	}()
	a.register(ctx, Registration{Name: "Administrator", Email: os.Getenv("ADMIN_EMAIL"), Password: os.Getenv("ADMIN_PASSWORD")}, "admin")
	return nil
}
func (a *App) staffList(w http.ResponseWriter, r *http.Request) any {
	u := a.user(r)
	administrator(u)
	if r.Method == "POST" {
		return a.register(r.Context(), body[Registration](w, r), "staff")
	}
	page, size := pagination(r)
	list := rows(r.Context(), a.DB, "SELECT id,name,email,role FROM users WHERE role='staff' ORDER BY created_at,id LIMIT $1 OFFSET $2", size+1, (page-1)*size)
	return paged(list, page, size)
}
