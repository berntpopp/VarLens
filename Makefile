.PHONY: dev build lint test typecheck package clean

# Development
dev:
	npm run dev

# Build for production
build:
	npm run build

# Lint with auto-fix
lint:
	npm run lint

# Run tests
test:
	npm run test

# Type checking
typecheck:
	npm run typecheck

# Package for all platforms
package:
	npm run build && npx electron-builder --mac --win --linux

# Clean build artifacts
clean:
	rm -rf out dist node_modules/.vite
