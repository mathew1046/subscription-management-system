package app

import "net/http"

func (a *App) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", a.Handle(func(w http.ResponseWriter, r *http.Request) any {
		err := a.DB.Ping(r.Context())
		require(err == nil, http.StatusServiceUnavailable, "UNAVAILABLE", "Database is unavailable.")
		return Object{"service": "brightloop-go", "status": "ok"}
	}))
	mux.HandleFunc("GET /api/auth/{action}", a.Handle(a.auth))
	mux.HandleFunc("POST /api/auth/{action}", a.Handle(a.auth))
	mux.HandleFunc("GET /api/staff", a.Handle(a.staffList))
	mux.HandleFunc("POST /api/staff", a.Handle(a.staffList))
	mux.HandleFunc("GET /api/subscriptions", a.Handle(a.subscriptions))
	mux.HandleFunc("POST /api/subscriptions", a.Handle(a.subscriptions))
	mux.HandleFunc("GET /api/subscriptions/{id}", a.Handle(a.subscriptions))
	mux.HandleFunc("POST /api/subscriptions/{id}/transition", a.Handle(a.transition))
	mux.HandleFunc("GET /api/invoices", a.Handle(a.invoices))
	mux.HandleFunc("GET /api/invoices/{id}", a.Handle(a.invoices))
	mux.HandleFunc("POST /api/invoices/{id}/{action}", a.Handle(a.invoiceAction))
	mux.HandleFunc("POST /api/payments", a.Handle(a.payment))
	mux.HandleFunc("GET /api/reports", a.Handle(a.report))
	mux.HandleFunc("POST /api/billing/run", a.Handle(a.runBilling))
	mux.HandleFunc("GET /api/{resource}", a.Handle(a.catalog))
	mux.HandleFunc("POST /api/{resource}", a.Handle(a.catalog))
	mux.HandleFunc("PUT /api/{resource}/{id}", a.Handle(a.catalog))
	mux.HandleFunc("/", a.Handle(func(w http.ResponseWriter, r *http.Request) any {
		panic(fault{404, "NOT_FOUND", "Unknown API endpoint or method."})
	}))
	return mux
}
