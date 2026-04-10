.PHONY: help rebuild dev build preview lint lint-check test test-watch test-coverage typecheck dist dist-linux dist-mac dist-win package package-linux package-mac package-win clean clean-all install reinstall all ci ci-full ci-build docs docs-dev docs-preview docs-screenshots

# Default target - show help
.DEFAULT_GOAL := help

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
# CI / Full Checks (mirrors GitHub Actions exactly)
#---------------------------------------------------------------------------

ci: lint-check format-check typecheck rebuild-node test ## Run all CI checks (lint, format, typecheck, rebuild, test)

ci-full: ## Run FULL CI pipeline (exactly mirrors GitHub Actions)
	@echo "=== CI Pipeline (mirrors GitHub Actions build.yml) ==="
	@echo ""
	@echo "Step 1/7: Installing dependencies..."
	npm ci
	@echo ""
	@echo "Step 2/7: Rebuilding native modules for Node.js (tests need Node-compatible binaries)..."
	npm run rebuild:node
	@echo ""
	@echo "Step 3/7: Running linter..."
	npm run lint:check
	@echo ""
	@echo "Step 4/7: Running Prettier format check..."
	npm run format:check
	@echo ""
	@echo "Step 5/7: Running type check..."
	npm run typecheck
	@echo ""
	@echo "Step 6/7: Running tests..."
	npm run test
	@echo ""
	@echo "Step 7/7: Rebuilding native modules for Electron..."
	npm run rebuild:electron
	@echo ""
	@echo "=== CI Pipeline PASSED ==="

ci-build: ci-full ## Run full CI + build (like GitHub Actions with dist)
	@echo ""
	@echo "Step 6/6: Building Electron app..."
	CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist
	@echo ""
	@echo "=== CI + Build PASSED ==="

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
# Setup & Cleanup
#---------------------------------------------------------------------------

install: ## Install dependencies and rebuild native modules
	npm install

clean: ## Clean build artifacts
	rm -rf out dist release node_modules/.vite

clean-all: clean ## Clean everything including node_modules
	rm -rf node_modules

reinstall: clean-all install ## Clean and reinstall everything
