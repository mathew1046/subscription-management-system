package main

import (
	"brightloop/internal/app"
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	a, err := app.New(ctx)
	if err != nil {
		slog.Error("startup failed: check database configuration")
		os.Exit(1)
	}
	defer a.DB.Close()
	mode := "serve"
	if len(os.Args) > 1 {
		mode = os.Args[1]
	}
	switch mode {
	case "migrate":
		if err = a.Migrate(ctx); err != nil {
			slog.Error("migration failed", "error", err)
			os.Exit(1)
		}
		return
	case "create-admin":
		if err = a.CreateAdmin(ctx); err != nil {
			slog.Error("admin creation failed; check input and duplicates")
			os.Exit(1)
		}
		return
	case "worker":
		a.Work(ctx)
		return
	case "serve":
	default:
		slog.Error("unknown command")
		os.Exit(1)
	}
	address := os.Getenv("HTTP_ADDR")
	if address == "" {
		address = "127.0.0.1:8080"
	}
	server := &http.Server{Addr: address, Handler: a.Routes(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 25 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	serveErr := make(chan error, 1)
	go func() {
		serveErr <- server.ListenAndServe()
	}()
	slog.Info("Brightloop API ready", "address", address)
	select {
	case err = <-serveErr:
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if shutdownErr := server.Shutdown(shutdown); shutdownErr != nil {
			slog.Error("HTTP server shutdown failed", "error", shutdownErr)
			if closeErr := server.Close(); closeErr != nil {
				slog.Error("HTTP server close failed", "error", closeErr)
			}
		}
		err = <-serveErr
	}
	if err != nil && err != http.ErrServerClosed {
		slog.Error("HTTP server failed", "error", err)
		os.Exit(1)
	}
}
