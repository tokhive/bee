.PHONY: tee-deps build test app

# Reuse an installed project-compatible Node; preflight checks the final tools.
APP_NODE_BIN ?= $(firstword $(wildcard $(HOME)/.nvm/versions/node/v24.22.1/bin .cache/toolchains/node-v24.22.1-darwin-arm64/bin))

tee-deps:
	bash scripts/prepare-tee.sh

build: tee-deps
	go build -o bin/bee ./cmd/bee

test: tee-deps
	go vet ./...
	go test -race -timeout=600s ./...

app: export PATH := $(if $(APP_NODE_BIN),$(abspath $(APP_NODE_BIN)):)$(PATH)
app: export CARGO_HOME := $(if $(CARGO_HOME),$(CARGO_HOME),$(if $(wildcard .cache/cargo-home/config.toml),$(CURDIR)/.cache/cargo-home,$(HOME)/.cargo))
app: export RUSTUP_TOOLCHAIN := $(if $(RUSTUP_TOOLCHAIN),$(RUSTUP_TOOLCHAIN),1.94)
app:
	@test "$$(uname -s)" = Darwin || { echo "make app requires macOS; actual=$$(uname -s); required=Darwin" >&2; exit 1; }
	# env makes macOS Make 3.81 resolve tools using the target's PATH.
	/usr/bin/env node desktop/scripts/preflight.mjs
	/usr/bin/env node desktop/scripts/prepare-tee.mjs
	/usr/bin/env npm --prefix desktop ci
	/usr/bin/env node desktop/scripts/build-bee.mjs
	/usr/bin/env APPLE_SIGNING_IDENTITY=- npm --prefix desktop run tauri -- build --debug --bundles app --ci --config '{"productName":"Bee S1 Dev"}' -- --locked
