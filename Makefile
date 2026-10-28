.PHONY: build test test-install test-menu

build:
	go build -o bin/bee ./cmd/bee

test-install:
	sh -n install.sh
	python3 scripts/test-install.py

test-menu:
	python3 scripts/test-menu.py

test: test-install test-menu
	go vet ./...
	go test -race -timeout=600s ./...
