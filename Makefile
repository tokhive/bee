.PHONY: build desktop-macos test test-install test-menu

build:
	go build -o bin/bee ./cmd/bee

# Bee.app and its .dmg for macOS. BEE_VERSION=major.minor.patch for a release
# build, ARCH=arm64|x64 to build for the other architecture; see desktop/README.md.
desktop-macos:
	cd desktop && npm ci && sh scripts/package-macos.sh $(ARCH)

test-install:
	sh -n install.sh
	python3 scripts/test-install.py

test-menu:
	python3 scripts/test-menu.py

test: test-install test-menu
	go vet ./...
	go test -race -timeout=600s ./...

