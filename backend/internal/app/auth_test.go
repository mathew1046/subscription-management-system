package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func authExpectFault(t *testing.T, code string, fn func()) {
	t.Helper()
	defer func() {
		got := recover()
		f, ok := got.(fault)
		if !ok || f.Code != code {
			t.Errorf("expected fault %s; got %v", code, got)
		}
	}()
	fn()
}

func TestPasswordPolicy(t *testing.T) {
	for _, password := range []string{"Abcdefgh!", "Übcdefgh!", "Good password!"} {
		t.Run(password, func(t *testing.T) { validatePassword(password) })
	}
	for _, password := range []string{"Abcdefg!", "abcdefgh!", "ABCDEFGH!", "Abcdefgh1", "Abcdefgh ", "Abcdefgh!" + strings.Repeat("x", 120), "Abcdefgh!\xff"} {
		t.Run(password, func(t *testing.T) {
			authExpectFault(t, "PASSWORD_POLICY", func() { validatePassword(password) })
		})
	}
}

func TestEmailNormalization(t *testing.T) {
	if got := cleanEmail(" Customer@Example.TEST "); got != "customer@example.test" {
		t.Fatalf("normalized email = %q", got)
	}
	for _, email := range []string{"broken", "A Person <a@example.test>", "a\r\n@example.test", "a@example.test,b@example.test"} {
		authExpectFault(t, "VALIDATION", func() { cleanEmail(email) })
	}
}

func TestPasswordHashVerification(t *testing.T) {
	a := &App{hashSlots: make(chan struct{}, 1)}
	ctx := context.Background()
	hash := a.hashPassword(ctx, "FixtureOnly!Aa9")
	if !a.verify(ctx, "FixtureOnly!Aa9", hash) || a.verify(ctx, "WrongFixture!Aa9", hash) {
		t.Fatal("password verification accepted the wrong password or rejected the correct one")
	}
	for _, malformed := range []string{"", "argon2id$bad$bad", "other$" + strings.Repeat("0", 32) + "$" + strings.Repeat("0", 64), "argon2id$" + strings.Repeat("0", 32) + "$" + strings.Repeat("z", 64)} {
		if a.verify(ctx, "FixtureOnly!Aa9", malformed) {
			t.Fatal("accepted malformed stored hash")
		}
	}
}

func TestMutationBoundary(t *testing.T) {
	a := &App{Origin: "http://localhost:3000"}
	for _, tc := range []struct {
		origin, contentType string
		status              int
	}{
		{"", "application/json", 403},
		{"http://untrusted.test", "application/json", 403},
		{a.Origin, "text/plain", 415},
		{a.Origin, "application/json; charset=utf-8", 200},
	} {
		r := httptest.NewRequest(http.MethodPost, "/api/example", strings.NewReader("{}"))
		r.Header.Set("Origin", tc.origin)
		r.Header.Set("Content-Type", tc.contentType)
		w := httptest.NewRecorder()
		a.Handle(func(http.ResponseWriter, *http.Request) any { return Object{"ok": true} })(w, r)
		if w.Code != tc.status {
			t.Errorf("origin %q content type %q: status %d, want %d", tc.origin, tc.contentType, w.Code, tc.status)
		}
	}
}

func TestStrictRegistrationBody(t *testing.T) {
	for _, input := range []string{
		`{"name":"Customer","email":"customer@example.test","password":"FixtureOnly!Aa9","role":"admin"}`,
		`{} {}`,
	} {
		authExpectFault(t, "VALIDATION", func() {
			r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(input))
			body[Registration](httptest.NewRecorder(), r)
		})
	}
}
