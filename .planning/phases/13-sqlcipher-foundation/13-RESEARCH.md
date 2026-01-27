# Phase 13: SQLCipher Foundation - Research

**Researched:** 2026-01-27
**Domain:** Native SQLite encryption with better-sqlite3-multiple-ciphers
**Confidence:** HIGH

## Summary

Phase 13 swaps the native database module from `better-sqlite3` to `better-sqlite3-multiple-ciphers`, a fork that adds SQLCipher-compatible encryption while maintaining API compatibility. The latest version (12.6.2, released January 19, 2026) provides prebuilt binaries for Electron 40 (ABI 143) across all three platforms (Windows, macOS, Linux).

The library is a drop-in replacement for better-sqlite3 — unencrypted databases work transparently without modification. Encryption is activated only when `PRAGMA key` is explicitly set. The underlying SQLite3MultipleCiphers extension defaults to the sqleet cipher (ChaCha20-Poly1305), but supports SQLCipher 4 for compatibility with standard SQLCipher tooling.

**Primary recommendation:** Use better-sqlite3-multiple-ciphers 12.6.2 as a transparent replacement, preserve existing rebuild workflow with `@electron/rebuild -f -w better-sqlite3-multiple-ciphers`, and defer encryption activation to Phase 14 — all existing functionality must work identically in Phase 13.

## Standard Stack

The established libraries/tools for SQLite encryption in Electron:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3-multiple-ciphers | 12.6.2 | Synchronous SQLite with encryption | Only maintained fork with multiple cipher support, prebuilt Electron 40 binaries, API-compatible with better-sqlite3 |
| @electron/rebuild | 4.0.2+ | Native module recompilation | Official Electron tool for rebuilding native addons, works reliably with better-sqlite3-multiple-ciphers |
| SQLite3MultipleCiphers | 2.2.7 | C++ encryption extension | Underlying encryption layer supporting sqleet, SQLCipher 4, and other ciphers |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| electron-vite | 5.0.0+ | Bundler with native module support | Externalization configuration for native modules |
| electron-builder | 26.4.0+ | Packaging with ASAR unpacking | Extracts .node files from ASAR, configures native module distribution |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| better-sqlite3-multiple-ciphers | @sqlcipher/better-sqlite3 | Not actively maintained; better-sqlite3-multiple-ciphers has fresher releases and better Electron support |
| sqleet default cipher | SQLCipher 4 cipher | Sqleet (ChaCha20) is faster on embedded systems; SQLCipher (AES-256-CBC) has broader ecosystem tooling. Phase 13 uses sqleet default, Phase 14+ can configure SQLCipher if needed |

**Installation:**
```bash
npm install better-sqlite3-multiple-ciphers@12.6.2 --save
npm install --save-dev @electron/rebuild@^4.0.2
```

## Architecture Patterns

### Recommended Project Structure
```
src/main/database/
├── DatabaseService.ts   # Add optional key parameter (Phase 14)
├── schema.ts            # FTS5 creation AFTER PRAGMA key
└── types.ts             # No changes needed

tests/
├── main/database/
│   ├── DatabaseService.test.ts  # Existing tests unchanged
│   └── sqlcipher.test.ts        # NEW: encryption proof tests
```

### Pattern 1: Drop-in Replacement Import
**What:** Change only the import statement; all API calls remain identical
**When to use:** Phase 13 migration — minimize diff surface area
**Example:**
```typescript
// Before (better-sqlite3)
import Database from 'better-sqlite3'
import type { Database as DatabaseType, Statement } from 'better-sqlite3'

// After (better-sqlite3-multiple-ciphers) — identical API
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType, Statement } from 'better-sqlite3-multiple-ciphers'
```

### Pattern 2: Conditional Encryption Initialization
**What:** Issue PRAGMA key only when key is provided, before schema initialization
**When to use:** Phase 14+ when encryption UI is added
**Example:**
```typescript
// Source: SQLCipher API best practices + SQLite3MultipleCiphers docs
constructor(dbPath: string = ':memory:', encryptionKey?: string) {
  this.db = new Database(dbPath)

  // CRITICAL: PRAGMA key must be FIRST operation if encrypting
  if (encryptionKey) {
    this.db.pragma(`key='${encryptionKey}'`)
  }

  // Then set other pragmas
  this.db.pragma('journal_mode = WAL')
  this.db.pragma('foreign_keys = ON')

  // Finally initialize schema (includes FTS5)
  initializeSchema(this.db)
}
```

### Pattern 3: FTS5 Creation After Encryption Key
**What:** Create FTS5 virtual tables only after PRAGMA key is set on encrypted databases
**When to use:** Always — FTS5 creation is a database operation requiring key validation
**Example:**
```typescript
// Source: SQLCipher documentation + community patterns
export function initializeSchema(db: DatabaseType): void {
  // Regular table creation works immediately
  db.exec(`
    CREATE TABLE IF NOT EXISTS cases (...);
    CREATE TABLE IF NOT EXISTS variants (...);
  `)

  // FTS5 creation AFTER PRAGMA key (if key was set)
  // This works for both encrypted and unencrypted databases
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS variants_fts
    USING fts5(gene_symbol, consequence, content=variants, content_rowid=id);
  `)
}
```

### Pattern 4: Transparent Unencrypted Operation
**What:** Databases work without encryption when no key is provided
**When to use:** Phase 13 — preserve v0.2.0 behavior exactly
**Example:**
```typescript
// No key provided = unencrypted database (transparent operation)
const db = new DatabaseService('/path/to/database.db')

// Existing v0.2.0 databases continue working unchanged
// File format remains identical to better-sqlite3
```

### Anti-Patterns to Avoid
- **Issuing PRAGMA key after first database operation:** SQLCipher validates keys lazily — the first operation (CREATE TABLE, SELECT, etc.) triggers encryption setup. Setting the key afterward fails.
- **Using db.pragma() with unescaped user input:** Always sanitize or use parameterized approaches for keys. Phase 13 defers user-provided keys to Phase 14, avoiding this issue.
- **Attempting to set encryption key in a transaction:** SQLCipher documentation explicitly warns against configuring encryption within transactions — always set key immediately after opening connection.
- **Relying on PRAGMA key error for wrong password:** PRAGMA key returns "ok" even with wrong password. Only subsequent operations throw SQLITE_NOTADB (error 26). Always test with a query.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Native module rebuild for Electron | Custom node-gyp scripts | `@electron/rebuild -f -w better-sqlite3-multiple-ciphers` | Handles ABI version detection, toolchain configuration, and platform-specific compiler flags automatically |
| ASAR unpacking for .node files | Manual file copying post-build | electron-builder `asarUnpack: ["**/*.node"]` | Integrated into packaging pipeline, handles path resolution for unpacked files |
| Key derivation function (KDF) | Custom PBKDF2 implementation | SQLCipher's built-in KDF (256,000 iterations SHA512) | Battle-tested, constant-time implementation, properly handles salt generation |
| Encryption wrong-key detection | Checking PRAGMA key return value | Query database and catch SQLITE_NOTADB (error 26) | PRAGMA key always returns "ok" — actual validation happens during first operation |

**Key insight:** Native module tooling is complex with platform-specific edge cases (Windows Build Tools, macOS universal binaries, Linux glibc versions). Use ecosystem-standard tools rather than custom scripts.

## Common Pitfalls

### Pitfall 1: Prebuilt Binary Availability Assumption
**What goes wrong:** Assuming prebuilt binaries exist for all Electron/Node versions leads to silent fallback to compilation, which fails without build tools installed
**Why it happens:** better-sqlite3-multiple-ciphers provides prebuilts for recent versions (v12.6.2 supports Electron v29-v40), but not all versions forever
**How to avoid:** Verify prebuilt support during research; use exact versions tested in CI (Electron 40, Node 24.11.1); fallback to `@electron/rebuild -f` to force compilation if needed
**Warning signs:** "prebuild-install" messages during npm ci; install takes >30 seconds (compilation vs <5s for prebuild download)

### Pitfall 2: Encryption Key Timing Order
**What goes wrong:** Setting PRAGMA key after schema initialization causes "file is not a database" errors on encrypted databases
**Why it happens:** SQLCipher requires key before any page read/write operations. CREATE TABLE triggers schema page writes before key is set.
**How to avoid:** Always issue PRAGMA key as the FIRST operation after opening connection, before any other pragma or SQL statement
**Warning signs:** Error message "SQLITE_NOTADB: file is not a database" (error 26) when key is actually correct

### Pitfall 3: FTS5 Creation Before Encryption Setup
**What goes wrong:** Creating FTS5 virtual tables before PRAGMA key on encrypted databases fails with cryptic errors
**Why it happens:** FTS5 virtual table creation performs database operations requiring key validation
**How to avoid:** Structure initialization: open connection → PRAGMA key → other pragmas → regular tables → FTS5 tables
**Warning signs:** FTS5-specific errors on encrypted databases; virtual table creation succeeds on unencrypted but fails on encrypted

### Pitfall 4: ASAR Packing Native Modules
**What goes wrong:** Electron app launches but crashes with "Cannot find module" errors for better-sqlite3-multiple-ciphers.node
**Why it happens:** Native .node files cannot be loaded from inside ASAR archives; they must be unpacked
**How to avoid:** electron-builder config must include `asarUnpack: ["**/*.node"]` or module-specific pattern
**Warning signs:** App works in dev (`npm run dev`) but crashes in packaged build (`npm run dist`)

### Pitfall 5: Dual-Mode Rebuild Workflow Misunderstanding
**What goes wrong:** Tests fail with "NODE_MODULE_VERSION mismatch" after running dev server
**Why it happens:** `npm run dev` rebuilds for Electron; tests run under Node.js with different ABI
**How to avoid:** Always run `npm run rebuild:node` before `npm test`; never run tests immediately after dev without rebuild
**Warning signs:** Error message includes "was compiled against a different Node.js version"; tests worked yesterday but fail today after dev work

### Pitfall 6: Assuming SQLCipher 4 is Default Cipher
**What goes wrong:** Attempting to open database with external SQLCipher tools fails despite correct password
**Why it happens:** better-sqlite3-multiple-ciphers defaults to sqleet cipher (ChaCha20), not SQLCipher 4 (AES-256-CBC)
**How to avoid:** Document default cipher choice; if SQLCipher 4 compatibility needed, explicitly set `db.pragma('cipher=sqlcipher')` before PRAGMA key
**Warning signs:** Database opens fine in app but fails in DB Browser for SQLite or sqlcipher CLI tools

### Pitfall 7: Windows Build Tools Not Installed
**What goes wrong:** Installation fails on Windows with "MSBuild.exe not found" or similar C++ compiler errors
**Why it happens:** better-sqlite3-multiple-ciphers is a native addon requiring Visual Studio Build Tools for compilation (when prebuilds unavailable)
**How to avoid:** GitHub Actions windows-latest includes build tools; local development requires Visual Studio Build Tools with "Desktop development with C++" workload
**Warning signs:** Installation fails only on Windows; error messages mention "MSBuild", "cl.exe", or "vcbuild.bat"

## Code Examples

Verified patterns from official sources:

### Database Initialization with Optional Encryption
```typescript
// Source: SQLCipher API + SQLite3MultipleCiphers PRAGMA documentation
export class DatabaseService {
  constructor(dbPath: string = ':memory:', encryptionKey?: string) {
    this.db = new Database(dbPath)

    // CRITICAL: If encrypting, PRAGMA key must be FIRST
    if (encryptionKey) {
      this.db.pragma(`key='${encryptionKey}'`)
    }

    // Now safe to set other pragmas
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')

    // Schema initialization (includes FTS5)
    initializeSchema(this.db)
  }
}
```

### Encryption Proof Test Pattern
```typescript
// Source: SQLCipher validation best practices + community testing patterns
import { describe, it, expect } from 'vitest'
import { tmpdir } from 'os'
import { join, existsSync, unlinkSync } from 'fs'
import Database from 'better-sqlite3-multiple-ciphers'

describe('SQLCipher Encryption', () => {
  it('encrypts database and requires correct key to access', () => {
    const dbPath = join(tmpdir(), `encrypted-${Date.now()}.db`)

    try {
      // Create encrypted database
      const db1 = new Database(dbPath)
      db1.pragma("key='test-password'")
      db1.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)')
      db1.prepare('INSERT INTO test (value) VALUES (?)').run('secret data')
      db1.close()

      // Reopen with correct key — should succeed
      const db2 = new Database(dbPath)
      db2.pragma("key='test-password'")
      const result = db2.prepare('SELECT value FROM test WHERE id = 1').get()
      expect(result).toEqual({ value: 'secret data' })
      db2.close()

      // Reopen with wrong key — should fail
      const db3 = new Database(dbPath)
      db3.pragma("key='wrong-password'")
      expect(() => {
        db3.prepare('SELECT * FROM test').all() // First operation triggers validation
      }).toThrow(/file is (not a database|encrypted)/) // SQLITE_NOTADB error 26
      db3.close()
    } finally {
      if (existsSync(dbPath)) unlinkSync(dbPath)
      if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`)
      if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`)
    }
  })

  it('works without key for unencrypted databases', () => {
    // Transparent operation without encryption
    const db = new Database(':memory:')
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)')
    db.prepare('INSERT INTO test (id) VALUES (?)').run(1)
    const result = db.prepare('SELECT id FROM test WHERE id = 1').get()
    expect(result).toEqual({ id: 1 })
    db.close()
  })

  it('supports FTS5 after encryption key is set', () => {
    const dbPath = join(tmpdir(), `fts5-encrypted-${Date.now()}.db`)

    try {
      const db = new Database(dbPath)
      db.pragma("key='test-password'")

      // FTS5 creation after PRAGMA key
      db.exec(`
        CREATE TABLE docs (id INTEGER PRIMARY KEY, content TEXT);
        CREATE VIRTUAL TABLE docs_fts USING fts5(content, content=docs, content_rowid=id);
      `)

      db.prepare('INSERT INTO docs (content) VALUES (?)').run('searchable text')

      const result = db.prepare('SELECT * FROM docs_fts WHERE docs_fts MATCH ?').all('searchable')
      expect(result.length).toBeGreaterThan(0)
      db.close()
    } finally {
      if (existsSync(dbPath)) unlinkSync(dbPath)
      if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`)
      if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`)
    }
  })
})
```

### Build Pipeline Configuration
```javascript
// Source: electron-vite + electron-builder best practices
// electron.vite.config.ts
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // Externalize native module (don't bundle)
        external: ['better-sqlite3-multiple-ciphers']
      }
    }
  }
})

// package.json (scripts)
{
  "postinstall": "npx @electron/rebuild -f -w better-sqlite3-multiple-ciphers",
  "rebuild:electron": "npx @electron/rebuild -f -w better-sqlite3-multiple-ciphers",
  "rebuild:node": "npm rebuild better-sqlite3-multiple-ciphers"
}

// package.json (electron-builder config)
{
  "build": {
    "npmRebuild": false, // Disable broken electron-builder auto-rebuild
    "asarUnpack": [
      "node_modules/better-sqlite3-multiple-ciphers/**/*"
    ],
    "files": [
      "out/**/*",
      "node_modules/better-sqlite3-multiple-ciphers/**/*"
    ]
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| better-sqlite3 (unencrypted only) | better-sqlite3-multiple-ciphers (encryption-capable) | Phase 13 (v0.3.0) | Drop-in replacement; encryption dormant until Phase 14 |
| electron-builder npmRebuild: true | npmRebuild: false + manual @electron/rebuild | v0.2.0 (Electron 20+) | electron-builder's auto-rebuild broken for Electron 20+; manual rebuild required |
| Separate rebuild scripts per module | Unified @electron/rebuild -f -w pattern | better-sqlite3-multiple-ciphers v8.0.0+ | Single command handles all ABI detection; -f forces rebuild |
| SQLCipher 3 (AES-256-CBC) | SQLCipher 4 (256k iterations, SHA512) | SQLCipher 4.0.0 (2018) | Stronger KDF by default; incompatible file format with SQLCipher 3 unless using legacy mode |

**Deprecated/outdated:**
- **electron-builder install-app-deps:** Broken for Electron 20+; use `@electron/rebuild` instead
- **better-sqlite3 with separate SQLCipher patches:** Unmaintained; better-sqlite3-multiple-ciphers is actively maintained fork
- **Manual node-gyp rebuild:** Error-prone with platform differences; `@electron/rebuild -f` handles toolchain detection

## Open Questions

Things that couldn't be fully resolved:

1. **SQLCipher 4 vs sqleet default for production use**
   - What we know: better-sqlite3-multiple-ciphers defaults to sqleet cipher (ChaCha20-Poly1305); SQLCipher 4 cipher (AES-256-CBC) available via `PRAGMA cipher='sqlcipher'`
   - What's unclear: Whether Varlens should use sqleet default or switch to SQLCipher 4 for ecosystem compatibility (DB Browser for SQLite, other tools)
   - Recommendation: Use sqleet default in Phase 13-14 (faster on modest hardware); defer SQLCipher 4 decision until external tooling need arises. Both are cryptographically sound.

2. **Prebuilt binary reliability for Electron 40 on all platforms**
   - What we know: v12.6.2 release notes explicitly list Electron v40 prebuilt support; release date January 19, 2026 (8 days ago)
   - What's unclear: Real-world testing on all three platforms (Windows, macOS x64/arm64, Linux x64/arm64) hasn't been validated yet
   - Recommendation: GitHub Actions CI will validate all platforms during Phase 13 implementation; fallback to `@electron/rebuild -f` works if prebuilds fail

3. **In-memory database encryption behavior**
   - What we know: `:memory:` databases work with better-sqlite3-multiple-ciphers; encryption key can be set
   - What's unclear: Whether encrypting in-memory databases provides meaningful security benefit (data still in process memory)
   - Recommendation: Phase 13 tests use `:memory:` for existing tests (unencrypted); new encryption tests use temp files to validate real encryption

## Sources

### Primary (HIGH confidence)
- [better-sqlite3-multiple-ciphers v12.6.2 npm](https://www.npmjs.com/package/better-sqlite3-multiple-ciphers) - Latest version, prebuilt support
- [better-sqlite3-multiple-ciphers GitHub releases](https://github.com/m4heshd/better-sqlite3-multiple-ciphers/releases) - Electron 40 prebuilt confirmation
- [better-sqlite3-multiple-ciphers API docs](https://github.com/m4heshd/better-sqlite3-multiple-ciphers/blob/master/docs/api.md) - key() and rekey() methods, pragma() usage
- [SQLCipher API documentation](https://www.zetetic.net/sqlcipher/sqlcipher-api/) - PRAGMA key initialization order, error detection
- [SQLite3MultipleCiphers SQL Pragmas](https://utelle.github.io/SQLite3MultipleCiphers/docs/configuration/config_sql_pragmas/) - Encryption configuration, initialization sequence
- [Electron 40.0.0 release notes](https://www.electronjs.org/blog/electron-40-0) - Node 24.11.1, ABI version 143

### Secondary (MEDIUM confidence)
- [better-sqlite3-multiple-ciphers troubleshooting guide](https://github.com/m4heshd/better-sqlite3-multiple-ciphers/blob/master/docs/troubleshooting.md) - Platform-specific build issues, Electron gotchas
- [SQLite3MultipleCiphers Overview](https://utelle.github.io/SQLite3MultipleCiphers/) - Cipher comparison, transparent unencrypted operation
- [electron-builder ASAR documentation](https://www.electronjs.org/docs/latest/tutorial/asar-archives) - Native module unpacking patterns
- [Electron node-abi GitHub](https://github.com/electron/node-abi) - ABI version registry, Electron 40 → ABI 143 mapping

### Tertiary (LOW confidence - community patterns)
- [WebSearch: better-sqlite3-multiple-ciphers common pitfalls](https://github.com/m4heshd/better-sqlite3-multiple-ciphers/issues/5) - Community Electron integration issues
- [WebSearch: SQLCipher wrong password handling](https://github.com/sqlcipher/sqlcipher/issues/233) - Error detection patterns from issue discussions
- [WebSearch: sqleet vs SQLCipher comparison](https://github.com/resilar/sqleet/issues/12) - Cipher performance and compatibility tradeoffs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - npm package verified, releases checked, Electron 40 prebuilds confirmed
- Architecture: HIGH - Official SQLCipher and SQLite3MultipleCiphers documentation, verified API patterns
- Pitfalls: HIGH - Documented in official troubleshooting guide, confirmed by community issues
- Cipher defaults: HIGH - Official SQLite3MultipleCiphers documentation states sqleet default
- FTS5 ordering: MEDIUM - Inferred from SQLCipher requirement that key be first operation; not explicitly documented for FTS5
- Prebuilt reliability: MEDIUM - Release notes confirm support, but platform testing pending CI validation

**Research date:** 2026-01-27
**Valid until:** 2026-02-27 (30 days - stable ecosystem, monthly validation recommended)
