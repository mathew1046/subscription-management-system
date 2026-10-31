package app

import (
	"context"
	"crypto/tls"
	"fmt"
	"github.com/jackc/pgx/v5"
	"log/slog"
	"net"
	"net/mail"
	"net/smtp"
	"os"
	"strings"
	"time"
)

func smtpSend(recipient, subject, body, id string) error {
	host, port := os.Getenv("SMTP_HOST"), os.Getenv("SMTP_PORT")
	if host == "" {
		return fmt.Errorf("SMTP not configured")
	}
	if port == "" {
		port = "1025"
	}
	from := os.Getenv("SMTP_FROM")
	if from == "" {
		from = "billing@brightloop.local"
	}
	sender, err := mail.ParseAddress(from)
	if err != nil {
		return err
	}
	to, err := mail.ParseAddress(recipient)
	if err != nil {
		return err
	}
	if strings.ContainsAny(subject+from+recipient, "\r\n") {
		return fmt.Errorf("invalid mail headers")
	}
	address := net.JoinHostPort(host, port)
	connection, err := net.DialTimeout("tcp", address, 5*time.Second)
	if err != nil {
		return err
	}
	defer connection.Close()
	_ = connection.SetDeadline(time.Now().Add(8 * time.Second))
	secure := os.Getenv("SMTP_SECURE") == "true"
	if secure {
		connection = tls.Client(connection, &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12})
	}
	client, err := smtp.NewClient(connection, host)
	if err != nil {
		return err
	}
	defer client.Close()
	if !secure {
		if ok, _ := client.Extension("STARTTLS"); ok {
			err = client.StartTLS(&tls.Config{ServerName: host, MinVersion: tls.VersionTLS12})
			if err != nil {
				return err
			}
			secure = true
		} else {
			ip := net.ParseIP(host)
			if host != "localhost" && host != "mailpit" && (ip == nil || !ip.IsLoopback()) {
				return fmt.Errorf("SMTP TLS required outside local development")
			}
		}
	}
	if user := os.Getenv("SMTP_USER"); user != "" {
		if !secure {
			return fmt.Errorf("SMTP credentials require TLS")
		}
		if err = client.Auth(smtp.PlainAuth("", user, os.Getenv("SMTP_PASSWORD"), host)); err != nil {
			return err
		}
	}
	if err = client.Mail(sender.Address); err != nil {
		return err
	}
	if err = client.Rcpt(to.Address); err != nil {
		return err
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "From: %s\r\nTo: %s\r\nSubject: %s\r\nMessage-ID: <%s@brightloop>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s", sender.String(), to.String(), subject, id, strings.ReplaceAll(body, "\n", "\r\n"))
	if err != nil {
		return err
	}
	if err = w.Close(); err != nil {
		return err
	}
	return client.Quit()
}
func (a *App) deliver(ctx context.Context) bool {
	return a.tx(ctx, func(tx pgx.Tx) any {
		pending := rows(ctx, tx, "SELECT * FROM outbox WHERE sent_at IS NULL AND attempts<8 AND available_at<=now() ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED")
		if len(pending) == 0 {
			return false
		}
		m := pending[0]
		err := smtpSend(str(m["recipient"]), str(m["subject"]), str(m["body"]), str(m["id"]))
		if err != nil {
			exec(ctx, tx, "UPDATE outbox SET attempts=attempts+1,last_error='SMTP delivery failed; inspect configuration',available_at=now()+interval '1 minute'*power(2,LEAST(attempts,6)) WHERE id=$1", m["id"])
			slog.Warn("email delivery deferred", "outbox_id", m["id"])
		} else {
			exec(ctx, tx, "UPDATE outbox SET sent_at=now(),body='',last_error=NULL WHERE id=$1", m["id"])
		}
		return true
	}).(bool)
}
func (a *App) Work(ctx context.Context) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		func() {
			defer func() {
				if p := recover(); p != nil {
					slog.Error("worker cycle failed", "kind", fmt.Sprintf("%T", p))
				}
			}()
			cycle, cancel := context.WithTimeout(ctx, 60*time.Second)
			defer cancel()
			a.Billing(cycle)
			for i := 0; i < 5; i++ {
				if !a.deliver(cycle) {
					break
				}
			}
			exec(cycle, a.DB, "DELETE FROM sessions WHERE expires_at<now()")
			exec(cycle, a.DB, "DELETE FROM password_resets WHERE expires_at<now()")
			exec(cycle, a.DB, "DELETE FROM rate_limits WHERE expires_at<now()")
		}()
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
