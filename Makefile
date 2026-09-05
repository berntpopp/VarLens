.PHONY: help rebuild dev dev-postgres web-dev build build-web build-web-server build-web-renderer preview lint lint-check agent-check test test-watch test-coverage perf-build perf-build-compare web-ci web-gate web-gate-static web-gate-integration web-gate-postgres web-gate-parity web-parity-e2e web-smoke web-test-report web-data-gather web-data-prepare web-data-verify web-ipc-fixtures typecheck dist dist-linux dist-mac dist-win package package-linux package-mac package-win clean clean-all install reinstall all ci ci-full ci-build ci-checks ci-startup-smoke ci-package-linux ci-packaged-smoke-linux ci-actions docs docs-dev docs-preview docs-screenshots pg-up pg-down pg-logs pg-psql pg-query-perf pg-seed-dev pg-hosted-smoke pg-reset

# Default target - show help
.DEFAULT_GOAL := help

CI_NODE_VERSION ?= $(shell tr -d '\n' < .nvmrc)
XVFB_RUN ?= $(shell if command -v xvfb-run >/dev/null 2>&1; then printf 'xvfb-run --auto-servernum --server-args="-screen 0 1280x960x24" '; fi)
WEB_DEV_PORT ?= 8787
WEB_DEV_SCHEMA_SLUG ?= $(shell basename "$$(pwd)" | tr '[:upper:].-' '[:lower:]__' | sed 's/[^a-z0-9_]/_/g; s/^[^a-z_]/web_/')
WEB_DEV_SCHEMA ?= web_dev_$(WEB_DEV_SCHEMA_SLUG)
WEB_DEV_RECOVERY_KEY_DIR ?= /tmp/varlens-web-dev
WEB_DEV_API_LATENCY_MS ?= 75
WEB_DEV_ADMIN_USERNAME ?= admin
WEB_DEV_ENV_FILE ?= .env.web.local
WEB_SMOKE_SPEC ?=

define ensure_ci_node
	@current_node="$$(node -v | sed 's/^v//')"; \
	if [ "$$current_node" != "$(CI_NODE_VERSION)" ]; then \
		echo "Node version mismatch: expected $(CI_NODE_VERSION) from .nvmrc, got $$current_node"; \
		echo "Switch Node versions locally before running this target."; \
		exit 1; \
	fi
endef

#---------------------------------------------------------------------------
# Mode toggle: desktop (default) / web (opt-in via VARLENS_WEB=1)
#
# Sets which projects vitest runs and whether `make dev` starts the web
# server. Direct targets (web-gate-static, etc.) still work standalone for
# web-only invocations.
#---------------------------------------------------------------------------

# Web mode is opt-in only. Set VARLENS_WEB=1 explicitly when a target
# should extend itself with web checks.
VARLENS_WEB ?= 0

# Export so it propagates to sub-makes and child processes; make does
# not export variables by default.
export VARLENS_WEB

ifeq ($(VARLENS_WEB),1)
    VITEST_EXTRA_ARGS := -- --project web-gate
else
    VITEST_EXTRA_ARGS :=
endif

#---------------------------------------------------------------------------
# Help
#---------------------------------------------------------------------------

help: ## Show this help message
	@echo "VarLens - Available Commands"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

#---------------------------------------------------------------------------
# Development
#---------------------------------------------------------------------------

rebuild: ## Restore/build native modules for Electron from the ABI cache (fixes native module version mismatch)
	npm run rebuild:electron

rebuild-node: ## Rebuild native modules for Node.js (needed before running tests)
	npm run rebuild:node

ifeq ($(VARLENS_WEB),1)
dev: web-dev ## Start development server (set VARLENS_WEB=1 for web mode)
else
dev: rebuild ## Start development server (set VARLENS_WEB=1 for web mode)
	npm run dev
endif

web-dev: ## Start local Postgres-backed web mode at http://localhost:$(WEB_DEV_PORT)/
	@if [ ! -f .env.postgres.local ]; then echo "Missing .env.postgres.local. Copy .env.postgres.example first."; exit 1; fi
	@set -a; . ./.env.postgres.local; if [ -f "$(WEB_DEV_ENV_FILE)" ]; then . "./$(WEB_DEV_ENV_FILE)"; fi; set +a; \
		node -e "const { Client } = require('pg'); const client = new Client({ connectionString: process.env.VARLENS_PG_URL }); client.connect().then(() => client.end()).then(() => process.exit(0)).catch(() => process.exit(1));" \
		&& echo "Postgres reachable at $$(node -e 'const url = new URL(process.env.VARLENS_PG_URL); console.log(url.host)') - skipping pg-up." \
		|| $(MAKE) pg-up
	VARLENS_WEB_BASE=/ npm run build:web
	@echo ""
	@echo "Starting VarLens web mode:"
	@echo "  URL:      http://localhost:$(WEB_DEV_PORT)/"
	@echo "  Health:   http://localhost:$(WEB_DEV_PORT)/healthz"
	@echo "  Postgres: .env.postgres.local"
	@if [ -f "$(WEB_DEV_ENV_FILE)" ]; then echo "  Web env:  $(WEB_DEV_ENV_FILE)"; else echo "  Web env:  $(WEB_DEV_ENV_FILE) (not present; using defaults)"; fi
	@echo "  Schema:   $(WEB_DEV_SCHEMA)"
	@set -a; . ./.env.postgres.local; if [ -f "$(WEB_DEV_ENV_FILE)" ]; then . "./$(WEB_DEV_ENV_FILE)"; fi; set +a; echo "  Secrets:  $${VARLENS_RECOVERY_KEY_DIR:-$(WEB_DEV_RECOVERY_KEY_DIR)}"
	@set -a; . ./.env.postgres.local; if [ -f "$(WEB_DEV_ENV_FILE)" ]; then . "./$(WEB_DEV_ENV_FILE)"; fi; set +a; echo "  API delay: $${VARLENS_WEB_API_LATENCY_MS:-$(WEB_DEV_API_LATENCY_MS)}ms"
	@echo "  Dev admin bootstrap: set VARLENS_ADMIN_PASSWORD_HASH for first run"
	@echo ""
	@set -a; . ./.env.postgres.local; if [ -f "$(WEB_DEV_ENV_FILE)" ]; then . "./$(WEB_DEV_ENV_FILE)"; fi; set +a; \
		NODE_ENV=development \
		APP_PATH_PREFIX="$${APP_PATH_PREFIX:-/}" \
		VARLENS_WEB_HOST="$${VARLENS_WEB_HOST:-127.0.0.1}" \
		VARLENS_WEB_PORT="$(WEB_DEV_PORT)" \
		VARLENS_WEB_API_LATENCY_MS="$${VARLENS_WEB_API_LATENCY_MS:-$(WEB_DEV_API_LATENCY_MS)}" \
		VARLENS_PG_SCHEMA="$(WEB_DEV_SCHEMA)" \
		VARLENS_RECOVERY_KEY_DIR="$${VARLENS_RECOVERY_KEY_DIR:-$(WEB_DEV_RECOVERY_KEY_DIR)}" \
		VARLENS_ADMIN_USERNAME="$${VARLENS_ADMIN_USERNAME:-$(WEB_DEV_ADMIN_USERNAME)}" \
		VARLENS_ADMIN_PASSWORD_HASH="$${VARLENS_ADMIN_PASSWORD_HASH:-}" \
		node out/web/server.cjs

dev-postgres: ## Start development server with PostgreSQL backend enabled
	@if [ ! -f .env.postgres.local ]; then echo "Missing .env.postgres.local. Copy .env.postgres.example first."; exit 1; fi
	@set -a; . ./.env.postgres.local; set +a; VARLENS_EXPERIMENTAL_STORAGE_BACKEND=postgres $(MAKE) dev

preview: ## Preview production build locally
	npm run preview

#---------------------------------------------------------------------------
# Build
#---------------------------------------------------------------------------

build: ## Build for production
	npm run build

build-web: ## Build web server and renderer bundles
	npm run build:web

build-web-server: ## Build the Fastify web server bundle
	npm run build:web:server

build-web-renderer: ## Build the browser web renderer bundle
	npm run build:web:renderer

dist: ## Build and package for current platform (for releases)
	npm run dist

dist-linux: ## Build and package for Linux only
	npm run dist:linux

dist-mac: ## Build and package for macOS only
	npm run dist:mac

dist-win: ## Build and package for Windows only
	npm run dist:win

package: build ## Package app for all platforms (mac, win, linux)
	npx electron-builder --mac --win --linux

package-linux: build ## Package app for Linux only
	npx electron-builder --linux

package-mac: build ## Package app for macOS only
	npx electron-builder --mac

package-win: build ## Package app for Windows only
	npx electron-builder --win

#---------------------------------------------------------------------------
# Code Quality
#---------------------------------------------------------------------------

lint: ## Lint and auto-fix code
	npm run lint

lint-check: ## Check linting without auto-fix
	npm run lint:check

agent-check: ## Check LLM-sustainable source size and context guardrails
	npm run agent:check

format: ## Format all files with Prettier
	npm run format

format-check: ## Check Prettier formatting without writing
	npm run format:check

typecheck: ## Run TypeScript type checking
	npm run typecheck

#---------------------------------------------------------------------------
# Testing
#---------------------------------------------------------------------------

test: ## Run tests once (set VARLENS_WEB=1 to include web-gate project)
	npm run test $(VITEST_EXTRA_ARGS)

test-watch: ## Run tests in watch mode
	npm run test:watch

test-coverage: ## Run tests with coverage report
	npm run test:coverage

perf-build: ## Measure build pipeline stage timings (LABEL=name, optional ONLY=id,id)
	node scripts/perf/measure-build.mjs $(or $(LABEL),local) $(if $(ONLY),--only $(ONLY),)

perf-build-compare: ## Compare two build perf baselines (BEFORE=a AFTER=b)
	@if [ -z "$(BEFORE)" ] || [ -z "$(AFTER)" ]; then \
		echo "usage: make perf-build-compare BEFORE=<label> AFTER=<label>"; exit 2; fi
	node scripts/perf/compare-build.mjs $(BEFORE) $(AFTER)

#---------------------------------------------------------------------------
# Phase 1 web-migration gate (see .planning/web/completed/testing/desktop-to-web-parity.md)
#---------------------------------------------------------------------------

web-gate-static: web-ipc-fixtures ## Run Layer 1 static gate tests (assumes Node ABI — run `make rebuild-node` first if needed)
	npx vitest run --project web-gate

web-ipc-fixtures: ## Validate IPC parity fixture manifest and referenced fixture data
	npm run test:ipc-parity-fixtures

web-gate-integration: ## Run Layer 2 web-only integration tests (skipped until out/web/ exists)
	npx vitest run --project web-gate tests/web-gate/integration

web-gate-postgres: build-web ## Run fail-loud Postgres-backed web integration tests (requires VARLENS_PG_URL)
	@if [ -z "$$VARLENS_PG_URL" ]; then echo "VARLENS_PG_URL is required for web-gate-postgres. This is intentionally opt-in and never part of default desktop CI."; exit 2; fi
	VARLENS_RECOVERY_KEY_DIR="$${VARLENS_RECOVERY_KEY_DIR:-$(WEB_DEV_RECOVERY_KEY_DIR)}" \
	npx vitest run --project web-gate tests/web-gate/integration
	VARLENS_RECOVERY_KEY_DIR="$${VARLENS_RECOVERY_KEY_DIR:-$(WEB_DEV_RECOVERY_KEY_DIR)}" \
	VARLENS_RUN_POSTGRES_E2E=1 npx vitest run --project main \
		tests/main/storage/postgres-cases-query-repository.e2e.test.ts \
		tests/main/storage/postgres-migrations-idempotent.test.ts \
		tests/main/web/auth/provision-platform-user-postgres.test.ts

web-gate-parity: web-data-verify ## Run Layer 3 parity scenarios (opt-in; boots Electron, switches native ABI)
	@echo "=== web-gate-parity (opt-in; switches native module to Electron ABI) ==="
	@if [ -z "$$VARLENS_PG_URL" ]; then echo "VARLENS_PG_URL is required for web-gate-parity. This validates desktop↔web parity against PostgreSQL."; exit 2; fi
	@if [ ! -f out/main/index.js ]; then echo "out/main/index.js missing — running 'make build' first"; npm run build; fi
	npm run rebuild:electron
	VARLENS_RUN_WEB_GATE_PARITY=1 VARLENS_RUN_WEB_PARITY_E2E=1 npx vitest run --project web-gate-parity tests/web-gate/parity

web-parity-e2e: web-data-verify ## Run manifest-backed desktop↔web parity E2E (requires VARLENS_PG_URL)
	@if [ -z "$$VARLENS_PG_URL" ]; then echo "VARLENS_PG_URL is required for web-parity-e2e. This is opt-in and never part of default desktop CI."; exit 2; fi
	@echo "=== web-parity-e2e (opt-in; switches native module to Electron ABI) ==="
	npm run rebuild:electron
	npm run build
	VARLENS_RUN_WEB_GATE_PARITY=1 VARLENS_RUN_WEB_PARITY_E2E=1 npx vitest run --project web-gate-parity tests/web-gate/parity/data-manifest-parity.test.ts tests/web-gate/parity/ipc-fixture-parity.test.ts

web-test-report: ## Generate web test report artifacts (VARLENS_WEB=1 runs full parity; uses VARLENS_PG_URL or .env.postgres.local)
	node scripts/reports/run-web-test-report.mjs

tests/web-smoke/node_modules/.bin/cypress: tests/web-smoke/package.json tests/web-smoke/package-lock.json
	CYPRESS_INSTALL_BINARY=0 npm --prefix tests/web-smoke ci
	npm --prefix tests/web-smoke exec -- cypress install

web-smoke: tests/web-smoke/node_modules/.bin/cypress ## Run browser smoke against VARLENS_BASE_URL (defaults to local :8787)
	VARLENS_BASE_URL="$${VARLENS_BASE_URL:-http://127.0.0.1:$(WEB_DEV_PORT)}" npm run test:web-smoke -- $$(if [ -n "$(WEB_SMOKE_SPEC)" ]; then printf -- "--spec %s" "$(WEB_SMOKE_SPEC)"; fi)

web-gate: web-gate-static ## Run the Phase 1 gate fast tests (parity is opt-in via web-gate-parity)
	@echo "Static web gate done. Run 'make web-gate-parity' to validate the desktop↔web parity path (opt-in)."

web-ci: rebuild-node build-web web-gate-static web-gate-postgres ## Opt-in web readiness gate; requires VARLENS_PG_URL

#---------------------------------------------------------------------------
# Web parity data gathering (opt-in; see .planning/web/completed/data/)
#---------------------------------------------------------------------------

DATA_ARGS ?=

web-data-gather: ## Gather/verify public parity data sources into gitignored cache (use DATA_ARGS='--fixture ID --allow-large')
	node scripts/data-fixtures/download-fixtures.mjs $(DATA_ARGS)

web-data-prepare: web-data-gather ## Transform gathered data into VarLens-ready generated fixtures
	node scripts/data-fixtures/prepare-fixtures.mjs $(DATA_ARGS)

web-data-verify: web-data-prepare ## Verify generated parity fixtures and source contracts
	node scripts/data-fixtures/verify-fixtures.mjs $(DATA_ARGS)

#---------------------------------------------------------------------------
# CI / Full Checks
#---------------------------------------------------------------------------

ci: ## Run all CI checks (lint, format, typecheck, rebuild, test). Set VARLENS_WEB=1 to include web-gate.
	$(MAKE) lint-check
	$(MAKE) format-check
	$(MAKE) typecheck
	$(MAKE) rebuild-node
	$(MAKE) test

ci-checks: ## Run the GitHub Actions "Checks (Ubuntu)" job under Node $(CI_NODE_VERSION)
	@echo "=== Checks (Ubuntu) using Node $(CI_NODE_VERSION) ==="
	$(ensure_ci_node)
	@echo ""
	@echo "Step 1/6: Installing dependencies..."
	npm ci
	@echo ""
	@echo "Step 2/6: Rebuilding native modules for Node.js..."
	npm run rebuild:node
	@echo ""
	@echo "Step 3/6: Running linter..."
	npm run lint:check
	@echo ""
	@echo "Step 4/6: Running Prettier format check..."
	npm run format:check
	@echo ""
	@echo "Step 5/6: Running type check..."
	npm run typecheck
	@echo ""
	@echo "Step 6/6: Running tests..."
	npm run test
	@echo ""
	@echo "=== Checks (Ubuntu) PASSED ==="

ci-startup-smoke: ## Run the GitHub Actions "Startup Smoke (Linux)" job under Node $(CI_NODE_VERSION)
	@echo "=== Startup Smoke (Linux) using Node $(CI_NODE_VERSION) ==="
	$(ensure_ci_node)
	@echo ""
	@echo "Step 1/4: Installing dependencies..."
	npm ci
	@echo ""
	@echo "Step 2/4: Rebuilding native modules for Electron..."
	npm run rebuild:electron
	@echo ""
	@echo "Step 3/4: Building Electron app..."
	npm run build
	@echo ""
	@echo "Step 4/4: Running startup smoke..."
	npx playwright test tests/e2e/startup-smoke.e2e.ts --workers=1
	@echo ""
	@echo "=== Startup Smoke (Linux) PASSED ==="

ci-package-linux: ## Run the Linux package validation job under Node $(CI_NODE_VERSION)
	@echo "=== Package (ubuntu-latest) using Node $(CI_NODE_VERSION) ==="
	$(ensure_ci_node)
	@echo ""
	@echo "Step 1/5: Installing dependencies..."
	npm ci
	@echo ""
	@echo "Step 2/5: Rebuilding native modules for Electron..."
	npm run rebuild:electron
	@echo ""
	@echo "Step 3/5: Building Electron app..."
	npx electron-vite build
	@echo ""
	@echo "Step 4/5: Running startup smoke..."
	$(XVFB_RUN)npx playwright test tests/e2e/startup-smoke.e2e.ts --workers=1
	@echo ""
	@echo "Step 5/5: Packaging Linux artifacts..."
	CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --publish never
	@echo ""
	@echo "=== Package (ubuntu-latest) PASSED ==="

ci-packaged-smoke-linux: ## Run the packaged-binary smoke on Linux (requires a built Linux artifact in release/)
	@echo "=== Packaged Smoke (Linux) using Node $(CI_NODE_VERSION) ==="
	$(ensure_ci_node)
	@echo ""
	@echo "Step 1/1: Running packaged smoke against release/linux-unpacked/varlens..."
	$(XVFB_RUN)npx playwright test tests/e2e/packaged-smoke.e2e.ts --workers=1
	@echo ""
	@echo "=== Packaged Smoke (Linux) PASSED ==="

ci-full: ci-actions ## Run the local GitHub Actions parity pipeline

ci-actions: ## Run the required local GitHub Actions parity pipeline under Node $(CI_NODE_VERSION)
	@echo "=== GitHub Actions parity pipeline using Node $(CI_NODE_VERSION) ==="
	$(MAKE) ci-checks
	$(MAKE) ci-startup-smoke
	$(MAKE) ci-package-linux
	$(MAKE) ci-packaged-smoke-linux
	@echo ""
	@echo "=== GitHub Actions parity pipeline PASSED ==="

ci-build: ci-actions ## Run the local GitHub Actions parity pipeline

all: ci build ## Run CI checks and build

#---------------------------------------------------------------------------
# Documentation
#---------------------------------------------------------------------------

docs: ## Build documentation site
	npm run docs:build

docs-dev: ## Start documentation dev server
	npm run docs:dev

docs-preview: ## Preview built documentation site
	npm run docs:preview

docs-screenshots: rebuild build ## Generate documentation screenshots from Electron app
	npm run docs:screenshots

#---------------------------------------------------------------------------
# PostgreSQL Development
#---------------------------------------------------------------------------

pg-up: ## Start local PostgreSQL dev container
	docker compose -f docker-compose.postgres.yml --env-file .env.postgres.local up -d

pg-down: ## Stop local PostgreSQL dev container
	docker compose -f docker-compose.postgres.yml --env-file .env.postgres.local down

pg-logs: ## Tail local PostgreSQL dev container logs
	docker compose -f docker-compose.postgres.yml --env-file .env.postgres.local logs -f postgres

pg-psql: ## Open psql in the local PostgreSQL dev container
	docker compose -f docker-compose.postgres.yml --env-file .env.postgres.local exec postgres sh -lc 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

pg-query-perf: build ## Import WGS fixture and run opt-in PostgreSQL WGS query perf benchmark
	@if [ ! -f .env.postgres.local ]; then echo "Missing .env.postgres.local. Copy .env.postgres.example first."; exit 1; fi
	@set -a; . ./.env.postgres.local; set +a; VARLENS_RUN_WGS_PERF=1 npx vitest run tests/perf/postgres-vcf-wgs-import.perf.test.ts
	@set -a; . ./.env.postgres.local; set +a; VARLENS_RUN_WGS_QUERY_PERF=1 VARLENS_PG_QUERY_EXPLAIN=1 npx vitest run tests/perf/postgres-wgs-query.perf.test.ts

pg-seed-dev: ## Seed deterministic PostgreSQL dev workspace data
	node scripts/postgres/seed-dev-workspace.mjs

pg-hosted-smoke: ## Run hosted PostgreSQL workspace smoke E2E
	VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-hosted-workspace-smoke.e2e.ts --workers=1

pg-reset: ## Destroy local PostgreSQL dev container and volume
	docker compose -f docker-compose.postgres.yml --env-file .env.postgres.local down -v

#---------------------------------------------------------------------------
# Setup & Cleanup
#---------------------------------------------------------------------------

install: ## Install dependencies and rebuild native modules
	npm install

clean: ## Clean build artifacts
	rm -rf out dist release node_modules/.vite

clean-all: clean ## Clean everything including node_modules
	rm -rf node_modules

reinstall: clean-all install ## Clean and reinstall everything
