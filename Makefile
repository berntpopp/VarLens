.PHONY: help rebuild dev dev-postgres build preview lint lint-check agent-check test test-watch test-coverage typecheck dist dist-linux dist-mac dist-win package package-linux package-mac package-win clean clean-all install reinstall all ci ci-full ci-build ci-checks ci-startup-smoke ci-package-linux ci-packaged-smoke-linux ci-actions docs docs-dev docs-preview docs-screenshots pg-up pg-down pg-logs pg-psql pg-query-perf pg-seed-dev pg-hosted-smoke pg-reset

# Default target - show help
.DEFAULT_GOAL := help

CI_NODE_VERSION ?= $(shell tr -d '\n' < .nvmrc)
XVFB_RUN ?= $(shell if command -v xvfb-run >/dev/null 2>&1; then printf 'xvfb-run --auto-servernum --server-args="-screen 0 1280x960x24" '; fi)

define ensure_ci_node
	@current_node="$$(node -v | sed 's/^v//')"; \
	if [ "$$current_node" != "$(CI_NODE_VERSION)" ]; then \
		echo "Node version mismatch: expected $(CI_NODE_VERSION) from .nvmrc, got $$current_node"; \
		echo "Switch Node versions locally before running this target."; \
		exit 1; \
	fi
endef

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

rebuild: ## Rebuild native modules for Electron (fixes native module version mismatch)
	npm run rebuild:electron

rebuild-node: ## Rebuild native modules for Node.js (needed before running tests)
	npm run rebuild:node

dev: rebuild ## Start development server with hot reload
	npm run dev

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

test: ## Run tests once
	npm run test

test-watch: ## Run tests in watch mode
	npm run test:watch

test-coverage: ## Run tests with coverage report
	npm run test:coverage

#---------------------------------------------------------------------------
# CI / Full Checks
#---------------------------------------------------------------------------

ci: lint-check format-check typecheck rebuild-node test ## Run all CI checks (lint, format, typecheck, rebuild, test)

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
