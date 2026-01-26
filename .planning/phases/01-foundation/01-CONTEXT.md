# Phase 1: Foundation - Context

**Gathered:** 2026-01-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Scaffold Electron + Vue 3 + Vuetify 3 project using electron-vite. Configure build tooling (TypeScript, ESLint, Prettier, Vitest) and verify better-sqlite3 native module integration. Success means all tooling works and the app launches.

</domain>

<decisions>
## Implementation Decisions

### Window Appearance
- Initial window size: 1440×900
- Window title: "Varlens"
- DevTools open automatically in development mode
- Single instance enforced (opening again focuses existing window)

### Makefile Commands
- Short verb naming: dev, build, lint, test, typecheck, package, clean
- Include packaging command even for Phase 1
- `make lint` auto-fixes issues (not report-only)
- `make package` targets all desktop platforms (macOS, Windows, Linux)

### Linting Strictness
- Strict mode: most issues are errors, builds fail on violations
- TypeScript: standard `strict: true` (strictNullChecks, noImplicitAny, etc.)
- Enforce `no-any`: disallow `any` type entirely
- Prettier + ESLint: Prettier for formatting, ESLint for logic/style

### Test Structure
- Tests in separate `tests/` folder mirroring src structure
- Naming convention: `*.test.ts`
- Code coverage configured from the start
- 70% minimum coverage threshold enforced

### Claude's Discretion
- Specific ESLint rule configurations beyond the above
- Vitest configuration details
- electron-vite config structure
- Prettier formatting options (quotes, semicolons, etc.)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches for Electron + Vue 3 scaffolding.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-01-26*
