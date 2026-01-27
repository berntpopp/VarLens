# Phase 13: SQLCipher Foundation - Context

**Gathered:** 2026-01-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Swap the database library from `better-sqlite3` to `better-sqlite3-multiple-ciphers` with encryption infrastructure wired up programmatically. No user-facing changes — all existing functionality preserved identically. The encryption capability is dormant until Phase 14 adds the UI.

</domain>

<decisions>
## Implementation Decisions

### Migration path
- Existing unencrypted databases continue working transparently after the library swap
- PRAGMA key is only issued when a key is explicitly provided — no key by default
- DatabaseService constructor signature is NOT modified in Phase 13 — the optional key parameter is deferred to Phase 14
- Same database file path, same .sqlite extension, same file format — drop-in replacement at the file level

### Key derivation approach
- Raw passphrase passed directly to PRAGMA key — SQLCipher handles KDF internally
- SQLCipher 4 defaults: AES-256-CBC, 4096-byte pages, 256,000 PBKDF2-HMAC-SHA512 iterations
- No custom KDF iterations or cipher configuration — use SQLCipher 4 standard settings
- Encryption key held in memory for the duration of the database session (needed for reopen/rekey scenarios in Phase 14)

### Build pipeline strategy
- Same rebuild pattern as current: `@electron/rebuild -f -w better-sqlite3-multiple-ciphers` — swap the module name everywhere
- Identical externalization in electron.vite.config.ts — new library treated the same as better-sqlite3
- asarUnpack for .node files unchanged
- Dual-mode rebuild workflow preserved: rebuild:node for tests (Node.js), rebuild:electron for packaging
- Follow existing GitHub Actions CI approach — evaluate prebuild availability during research

### Test boundary
- Minimal encryption proof: create encrypted DB, close, reopen with correct key, verify query works; wrong key returns error; FTS5 works after PRAGMA key
- Existing tests run completely unchanged — the library swap must be invisible to the existing test suite
- New encryption tests in a separate file (e.g., `tests/sqlcipher.test.ts`)
- CI must pass on all three platforms (Windows, macOS, Linux) — platform-specific native module issues caught early

### Claude's Discretion
- Exact import path adjustments if the new library has different module resolution
- How to handle any API surface differences between better-sqlite3 and better-sqlite3-multiple-ciphers
- Makefile and package.json script naming for the new module
- Temporary test database file cleanup strategy

</decisions>

<specifics>
## Specific Ideas

- The swap should be completely invisible to the end user — identical app behavior to v0.2.0
- Follow the existing CI/build patterns as closely as possible to minimize disruption
- Research flag from STATE.md: verify `better-sqlite3-multiple-ciphers` prebuilt binaries for Electron 40 on all 3 platforms

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 13-sqlcipher-foundation*
*Context gathered: 2026-01-27*
