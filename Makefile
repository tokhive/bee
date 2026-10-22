.PHONY: build test test-install

build:
	go build -o bin/bee ./cmd/bee

test-install:
	sh -n install.sh
	python3 scripts/test-install.py

test: test-install
	go vet ./...
	go test -race -timeout=600s ./...
