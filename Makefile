.PHONY: tee-deps build test

tee-deps:
	bash scripts/prepare-tee.sh

build: tee-deps
	go build -o bin/bee ./cmd/bee

test: tee-deps
	go vet ./...
	go test -race -timeout=600s ./...
