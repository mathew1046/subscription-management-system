package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestUserRatePolicy(t *testing.T) {
	const userID = "00000000-0000-4000-8000-000000000001"
	for _, tc := range []struct {
		method, key string
		limit       int
	}{
		{http.MethodGet, "user:read:" + userID, 300},
		{http.MethodHead, "user:read:" + userID, 300},
		{http.MethodPost, "user:mutation:" + userID, 60},
		{http.MethodPut, "user:mutation:" + userID, 60},
		{http.MethodPatch, "user:mutation:" + userID, 60},
		{http.MethodDelete, "user:mutation:" + userID, 60},
		{http.MethodOptions, "user:mutation:" + userID, 60},
	} {
		t.Run(tc.method, func(t *testing.T) {
			key, limit := userRatePolicy(userID, tc.method)
			if key != tc.key || limit != tc.limit {
				t.Fatalf("policy = (%q, %d), want (%q, %d)", key, limit, tc.key, tc.limit)
			}
			otherKey, _ := userRatePolicy("00000000-0000-4000-8000-000000000002", tc.method)
			if digest(key) == digest(otherKey) {
				t.Fatal("different users share a rate-limit key")
			}
		})
	}
	if authRateWindow != 15*time.Minute || userRateWindow != time.Minute {
		t.Fatal("unexpected auth or user rate window")
	}
}

func TestRateLimitResponse(t *testing.T) {
	a := &App{}
	for _, seconds := range []int{1, 37, 60, 900} {
		t.Run(strconv.Itoa(seconds), func(t *testing.T) {
			w := httptest.NewRecorder()
			r := httptest.NewRequest(http.MethodGet, "/api/subscriptions", nil)
			a.Handle(func(http.ResponseWriter, *http.Request) any {
				panic(rateLimitFault{fault{429, "RATE_LIMIT", "Too many attempts. Try again later."}, seconds})
			})(w, r)
			if w.Code != http.StatusTooManyRequests || w.Header().Get("Retry-After") != strconv.Itoa(seconds) {
				t.Fatalf("status %d, Retry-After %q; want 429, %d", w.Code, w.Header().Get("Retry-After"), seconds)
			}
			var response struct {
				Error struct {
					Code, Message string
				}
				RequestID string `json:"request_id"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if response.Error.Code != "RATE_LIMIT" || response.Error.Message != "Too many attempts. Try again later." {
				t.Fatalf("unexpected error envelope: %s", w.Body.String())
			}
			if response.RequestID == "" || response.RequestID != w.Header().Get("X-Request-ID") {
				t.Fatal("missing or inconsistent request ID")
			}
			if w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("rate-limit response may be cached")
			}
		})
	}
}

func TestOtherFailuresDoNotSetRetryAfter(t *testing.T) {
	for _, failure := range []any{fault{401, "UNAUTHENTICATED", "Sign in to continue."}, context.DeadlineExceeded} {
		w := httptest.NewRecorder()
		(&App{}).Handle(func(http.ResponseWriter, *http.Request) any { panic(failure) })(w, httptest.NewRequest(http.MethodGet, "/api/subscriptions", nil))
		if w.Header().Get("Retry-After") != "" {
			t.Fatal("unrelated failure has a rate-limit Retry-After header")
		}
		want := http.StatusUnauthorized
		if failure == context.DeadlineExceeded {
			want = http.StatusServiceUnavailable
		}
		if w.Code != want {
			t.Fatalf("status = %d, want %d", w.Code, want)
		}
	}
}

func TestLogoutBypassesRateBudgets(t *testing.T) {
	// A missing pool makes any accidental limiter/session lookup fail. Logout
	// without a cookie must still clear the browser cookie without either budget.
	a := &App{Origin: "http://localhost:3000"}
	r := httptest.NewRequest(http.MethodPost, "/api/auth/logout", strings.NewReader("{}"))
	r.Header.Set("Origin", a.Origin)
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	a.Routes().ServeHTTP(w, r)
	if w.Code != http.StatusOK || w.Header().Get("Retry-After") != "" {
		t.Fatalf("logout status %d: %s", w.Code, w.Body.String())
	}
	cookies := w.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != sessionCookie || cookies[0].MaxAge >= 0 {
		t.Fatal("logout did not expire the session cookie")
	}
}
