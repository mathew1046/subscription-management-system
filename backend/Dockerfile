FROM golang:1.27.3-alpine AS builder
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /brightloop ./cmd/server
FROM alpine:3.23
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 app
COPY --from=builder /brightloop /usr/local/bin/brightloop
USER app
EXPOSE 8080
ENTRYPOINT ["brightloop"]
CMD ["serve"]
