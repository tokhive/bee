.PHONY: build test

build:
	go build -o bin/bee ./cmd/bee

test:
	go vet ./...
	go test -race -timeout=600s ./...
