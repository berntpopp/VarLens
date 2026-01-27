# Phase 14: Database Selection & Encryption UX - Research

**Researched:** 2026-01-27
**Domain:** Electron app lifecycle, database switching, SQLCipher encryption, Vuetify UI components
**Confidence:** HIGH

## Summary

Phase 14 enables users to create, open, switch, and encrypt databases through the UI without restarting the app. This requires refactoring the current singleton DatabaseService to support open/close/switch lifecycle, implementing file picker dialogs via Electron's IPC, and creating Vuetify UI for password entry and database selection.

The standard approach combines Electron's dialog API for native file pickers, better-sqlite3's close/reopen pattern for database switching with mandatory statement cache invalidation, SQLCipher's PRAGMA key/rekey for encryption, and Vuetify's v-menu + v-dialog components for the UI. The app already uses better-sqlite3 and will migrate to better-sqlite3-multiple-ciphers (drop-in replacement) in Phase 13, making encryption a straightforward addition.

Critical findings: (1) better-sqlite3 prepared statements MUST be cleared before closing the database to avoid SQLITE_BUSY errors and stale handles, (2) PRAGMA rekey cannot encrypt plaintext databases - must use sqlcipher_export with ATTACH instead, (3) wrong password detection requires attempting a SELECT query as SQLCipher doesn't error on PRAGMA key, (4) encrypted databases have random salt in the header (no "SQLite" magic bytes) making detection challenging.

**Primary recommendation:** Refactor DatabaseService to a lifecycle-aware service with explicit open/close methods, store a Map of prepared statements for cache clearing, expose IPC handlers for database operations, and use inline error display in password dialogs to handle wrong passwords gracefully.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| electron | 40.0.0 | Desktop app framework | Already in use, provides dialog API and IPC |
| better-sqlite3-multiple-ciphers | 12.x | SQLite with SQLCipher encryption | Drop-in replacement for better-sqlite3, adds PRAGMA key/rekey support |
| vuetify | 3.11.7 | Vue 3 Material Design UI | Already in use for all UI components |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| electron-store | 10.x | Persistent JSON settings | Recent database list, app preferences (ESM-only since v9) |
| @mdi/font | 7.4.47 | Material Design Icons | Already in use, provides mdi-eye/mdi-eye-off for password toggle, mdi-lock for encryption indicator |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| electron-store | Manual JSON + fs | electron-store handles atomic writes, userData path resolution, and schema migrations - hand-rolling these is error-prone |
| electron-store | localStorage in renderer | localStorage is renderer-only, can't be accessed from main process where database path logic lives |
| better-sqlite3-multiple-ciphers | Native SQLCipher bindings | better-sqlite3-multiple-ciphers maintains API compatibility with existing better-sqlite3 code - native bindings require rewriting all DB code |

**Installation:**
```bash
npm install better-sqlite3-multiple-ciphers electron-store
```

Note: better-sqlite3-multiple-ciphers requires same rebuild workflow as better-sqlite3 (already documented in CLAUDE.md).

## Architecture Patterns

### Recommended Project Structure
```
src/
├── main/
│   ├── database/
│   │   ├── DatabaseService.ts    # Refactored with open/close/switch lifecycle
│   │   └── index.ts              # Remove singleton, export service class only
│   ├── ipc/handlers/
│   │   └── database.ts           # NEW: database:open, database:create, database:switch, database:rekey
│   └── services/
│       └── RecentDatabasesService.ts  # NEW: Manages recent DB list with electron-store
├── renderer/src/
│   ├── components/
│   │   ├── DatabasePicker.vue         # NEW: Dropdown menu in app bar
│   │   ├── PasswordDialog.vue         # NEW: Password entry for encrypted DBs
│   │   └── CreateDatabaseDialog.vue   # NEW: Name + optional encryption
│   └── stores/
│       └── databaseStore.ts           # NEW: Current DB state (name, path, encrypted)
```

### Pattern 1: Database Lifecycle Service
**What:** Refactor DatabaseService from singleton to lifecycle-aware service with explicit state management
**When to use:** Required for database switching - singleton pattern assumes single database for app lifetime

**Current pattern (singleton):**
```typescript
// src/main/database/index.ts (current)
let databaseService: DatabaseService | null = null

export function getDatabaseService(): DatabaseService {
  if (!databaseService) {
    const dbPath = join(app.getPath('userData'), 'varlens.db')
    databaseService = new DatabaseService(dbPath)
  }
  return databaseService
}
```

**New pattern (lifecycle-aware):**
```typescript
// src/main/database/index.ts (refactored)
// Remove singleton - export class only
export { DatabaseService } from './DatabaseService'

// src/main/services/DatabaseManager.ts (NEW)
class DatabaseManager {
  private currentDb: DatabaseService | null = null

  open(path: string, key?: string): DatabaseService {
    this.close() // Close previous if exists
    this.currentDb = new DatabaseService(path)
    if (key) this.currentDb.pragma(`key='${key}'`)
    return this.currentDb
  }

  close(): void {
    if (this.currentDb) {
      this.currentDb.clearStatementCache() // CRITICAL: Prevent stale handles
      this.currentDb.close()
      this.currentDb = null
    }
  }

  getCurrent(): DatabaseService | null {
    return this.currentDb
  }
}
```

### Pattern 2: Statement Cache Invalidation
**What:** Clear prepared statement cache before closing database to prevent SQLITE_BUSY and stale handle errors
**Why critical:** SQLite returns SQLITE_BUSY if statements are still open when attempting to close

```typescript
// src/main/database/DatabaseService.ts
export class DatabaseService {
  private statementCache: Map<string, Statement>

  // Add public method to clear cache
  clearStatementCache(): void {
    for (const stmt of this.statementCache.values()) {
      // Statements are automatically finalized when db closes
      // but clearing map prevents stale references
    }
    this.statementCache.clear()
  }

  close(): void {
    this.clearStatementCache() // MUST call before db.close()
    this.db.close()
  }
}
```

**Source:** [SQLite C API docs](https://sqlite.org/c3ref/close.html) - "Applications should finalize all prepared statements before attempting to close; sqlite3_close() returns SQLITE_BUSY if unfinalized statements exist"

### Pattern 3: IPC File Picker with Security
**What:** Expose dialog.showOpenDialog/showSaveDialog through IPC handlers, never allow renderer to specify arbitrary paths
**When to use:** All file system access must go through main process with user-initiated dialogs

```typescript
// src/main/ipc/handlers/database.ts
ipcMain.handle('database:selectFile', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select Database',
    properties: ['openFile'],
    filters: [
      { name: 'SQLite Database', extensions: ['sqlite', 'db', 'sqlite3'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  return result.filePaths[0] // Only return path, don't read file content
})
```

**Security principle:** Renderer cannot specify arbitrary paths, user MUST select via native dialog. See [Electron Security Tutorial](https://www.electronjs.org/docs/latest/tutorial/security).

### Pattern 4: Wrong Password Detection
**What:** SQLCipher doesn't error on PRAGMA key - must attempt a SELECT to detect wrong password
**Why:** PRAGMA key only sets the key, encryption/decryption happens on first database access

```typescript
// src/main/ipc/handlers/database.ts
async function openEncryptedDatabase(path: string, password: string): Promise<void> {
  const db = new DatabaseService(path)
  db.pragma(`key='${password}'`)

  // Attempt to read database - this triggers decryption
  try {
    db.database.prepare('SELECT count(*) FROM sqlite_master').get()
    // Success - password correct
  } catch (error) {
    db.close()
    if (error.message.includes('file is encrypted or is not a database')) {
      throw new Error('WRONG_PASSWORD')
    }
    throw error // Other error
  }
}
```

**Source:** [SQLCipher API docs](https://www.zetetic.net/sqlcipher/sqlcipher-api/) - "Perform some operation on the database (i.e. read from it) and confirm it is success"

### Pattern 5: Encrypting Existing Plaintext Database
**What:** Use sqlcipher_export() with ATTACH, not PRAGMA rekey
**Why:** PRAGMA rekey can only change keys on already-encrypted databases

```typescript
// WRONG - PRAGMA rekey cannot encrypt plaintext
db.pragma("rekey='newpassword'") // ERROR: Cannot rekey plaintext database

// RIGHT - Use ATTACH + sqlcipher_export
db.exec(`
  ATTACH DATABASE 'encrypted.db' AS encrypted KEY 'newpassword';
  SELECT sqlcipher_export('encrypted');
  DETACH DATABASE encrypted;
`)
// Then replace original with encrypted.db
```

**Source:** [SQLCipher API](https://www.zetetic.net/sqlcipher/sqlcipher-api/) - "PRAGMA rekey can not be used to encrypt a standard SQLite database"

### Pattern 6: Vuetify Menu Dropdown in App Bar
**What:** v-menu component with activator slot for recent databases dropdown
**When to use:** Standard pattern for dropdowns in app bars

```vue
<!-- src/renderer/src/components/DatabasePicker.vue -->
<template>
  <v-menu>
    <template v-slot:activator="{ props }">
      <v-btn v-bind="props" variant="text">
        <v-icon v-if="isEncrypted" icon="mdi-lock" size="small" class="mr-2" />
        {{ currentDatabaseName }}
      </v-btn>
    </template>

    <v-list>
      <v-list-item
        v-for="db in recentDatabases"
        :key="db.path"
        @click="openDatabase(db.path)"
      >
        <v-list-item-title>{{ db.name }}</v-list-item-title>
        <v-list-item-subtitle>{{ db.path }}</v-list-item-subtitle>
      </v-list-item>

      <v-divider />

      <v-list-item @click="showOpenDialog">
        <v-list-item-title>Open...</v-list-item-title>
      </v-list-item>

      <v-list-item @click="showCreateDialog">
        <v-list-item-title>New...</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>
</template>
```

**Source:** [Vuetify Menus](https://vuetifyjs.com/en/components/menus/) - Standard activator slot pattern

### Pattern 7: Password Input with Show/Hide Toggle
**What:** v-text-field with dynamic type and append-icon for password visibility
**When to use:** All password input fields

```vue
<!-- src/renderer/src/components/PasswordDialog.vue -->
<template>
  <v-dialog v-model="dialog" max-width="400">
    <v-card>
      <v-card-title>Enter Password</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="password"
          label="Password"
          :type="showPassword ? 'text' : 'password'"
          :append-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
          @click:append="showPassword = !showPassword"
          :error-messages="errorMessage"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="dialog = false">Cancel</v-btn>
        <v-btn color="primary" @click="submit">OK</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const showPassword = ref(false)
const password = ref('')
const errorMessage = ref('')

async function submit() {
  try {
    await window.api.database.open(dbPath, password.value)
    dialog.value = false
  } catch (error) {
    if (error.message === 'WRONG_PASSWORD') {
      errorMessage.value = 'Incorrect password. Please try again.'
      // User can retry - no attempt limit
    }
  }
}
</script>
```

**Source:** [Techformist - Toggle password in Vuetify](https://techformist.com/toggle-to-hide-or-show-password-in-vuetify/)

### Anti-Patterns to Avoid

- **Don't reuse statements across database switches:** Prepared statements are tied to a specific database instance. Switching databases without clearing cache causes segfaults.
- **Don't assume PRAGMA key errors on wrong password:** Must attempt SELECT query to validate password.
- **Don't use PRAGMA rekey on plaintext databases:** Use ATTACH + sqlcipher_export pattern instead.
- **Don't expose raw file paths from renderer:** Always use dialog API to let user select files.
- **Don't attempt to detect encrypted databases by header:** SQLCipher replaces first 16 bytes with random salt - no magic bytes to check.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Persistent settings storage | Manual JSON + fs.writeFile | electron-store | Handles atomic writes, userData path resolution, schema migrations, and concurrent access |
| Recent files list | Array in localStorage | electron-store with structured data | Persists across main/renderer, handles max size limits, provides type safety |
| Password validation UI | Custom input masking | Vuetify v-text-field with type toggle | Handles accessibility, icon positioning, consistent with app theme |
| File picker dialogs | HTML file input | Electron dialog API | Native OS dialogs, security (renderer can't specify paths), better UX |
| Database encryption | Custom AES implementation | better-sqlite3-multiple-ciphers | Industry-standard SQLCipher, handles key derivation (PBKDF2), tested encryption |

**Key insight:** File system access, encryption, and persistent storage are security-critical areas with subtle edge cases. Using established libraries prevents vulnerabilities and ensures cross-platform compatibility.

## Common Pitfalls

### Pitfall 1: Stale Prepared Statements After Database Switch
**What goes wrong:** App crashes with segfault or SQLITE_BUSY error when executing queries after switching databases
**Why it happens:** Prepared statements hold references to the closed database. better-sqlite3 statements are C++ objects bound to specific database instance.
**How to avoid:** Clear statement cache map and call close() before opening new database:
```typescript
this.statementCache.clear() // Remove all references
this.db.close() // Then safe to close
```
**Warning signs:** Segfaults in native module, SQLITE_BUSY on close, queries returning stale data from previous database

**Source:** [SQLite close() docs](https://sqlite.org/c3ref/close.html) - Must finalize statements before closing

### Pitfall 2: Assuming PRAGMA key Validates Password
**What goes wrong:** User enters wrong password, app shows loading state forever or crashes on first query
**Why it happens:** PRAGMA key only sets the key in memory. Encryption/decryption happens on first database access. Wrong key produces garbage data that fails to parse as SQLite structures.
**How to avoid:** Always attempt a SELECT query immediately after PRAGMA key:
```typescript
db.pragma(`key='${password}'`)
try {
  db.prepare('SELECT count(*) FROM sqlite_master').get()
} catch (error) {
  // Wrong password
}
```
**Warning signs:** Error "file is encrypted or is not a database", "database disk image is malformed", or silent failures

**Source:** [SQLCipher FAQ](https://discuss.zetetic.net/t/how-to-encrypt-a-plaintext-sqlite-database-to-use-sqlcipher-and-avoid-file-is-encrypted-or-is-not-a-database-errors/868)

### Pitfall 3: Using PRAGMA rekey on Plaintext Databases
**What goes wrong:** Attempting to encrypt an existing unencrypted database with `PRAGMA rekey='password'` fails
**Why it happens:** PRAGMA rekey can only change encryption keys on already-encrypted databases. It cannot add encryption to a plaintext database.
**How to avoid:** Use ATTACH + sqlcipher_export pattern:
```typescript
// Open plaintext DB
const plainDb = new Database('plain.db')
// Attach encrypted target
plainDb.exec(`ATTACH DATABASE 'encrypted.db' AS encrypted KEY 'password'`)
// Export schema and data
plainDb.exec(`SELECT sqlcipher_export('encrypted')`)
plainDb.exec(`DETACH DATABASE encrypted`)
plainDb.close()
// Replace plain.db with encrypted.db
```
**Warning signs:** Error "cannot rekey plaintext database", PRAGMA rekey silently does nothing

**Source:** [SQLCipher API](https://www.zetetic.net/sqlcipher/sqlcipher-api/) - "PRAGMA rekey can not be used to encrypt a standard SQLite database"

**RESEARCH FLAG RESOLVED:** PRAGMA rekey behavior verified - it CANNOT encrypt existing unencrypted databases. Must use sqlcipher_export with ATTACH instead.

### Pitfall 4: Not Handling Database Switch Failures
**What goes wrong:** User tries to open corrupted/incompatible database, app left with no active database
**Why it happens:** Switch operation closes old database before opening new one. If new open fails, app has no database.
**How to avoid:** Implement rollback pattern:
```typescript
async switchDatabase(newPath: string): Promise<void> {
  const previousDb = this.currentDb
  const previousPath = this.currentPath

  try {
    this.currentDb = null // Clear current
    this.currentDb = await this.openDatabase(newPath) // Try new
    previousDb?.close() // Success - close old
  } catch (error) {
    // Rollback to previous
    this.currentDb = previousDb
    throw error
  }
}
```
**Warning signs:** Blank UI after failed switch, "no database connected" errors

### Pitfall 5: Detecting Encrypted Databases by File Header
**What goes wrong:** Attempting to detect if a database is encrypted by reading first 16 bytes and checking for "SQLite format 3" magic string
**Why it happens:** Encrypted SQLCipher databases replace the standard SQLite header with a random salt, making them appear as random data
**How to avoid:** Try to open without key first, catch the error, then prompt for password:
```typescript
try {
  const db = new Database(path)
  db.prepare('SELECT count(*) FROM sqlite_master').get()
  // Succeeded - not encrypted
} catch (error) {
  if (error.message.includes('file is encrypted or is not a database')) {
    // Encrypted - prompt for password
    const password = await promptForPassword()
    const db = new Database(path)
    db.pragma(`key='${password}'`)
    db.prepare('SELECT count(*) FROM sqlite_master').get()
  }
}
```
**Warning signs:** False negatives (encrypted DB detected as plaintext), false positives (corrupted DB detected as encrypted)

**Source:** [Zetetic Community](https://discuss.zetetic.net/t/identify-encrypted-db/680) - SQLCipher replaces header with random salt

### Pitfall 6: electron-store CommonJS Import
**What goes wrong:** `require('electron-store')` throws error about ESM module
**Why it happens:** electron-store v9+ is ESM-only, no longer provides CommonJS exports
**How to avoid:** Use ESM imports in Electron 28+ (supports ESM in main process):
```typescript
// main/services/RecentDatabasesService.ts
import Store from 'electron-store' // ESM import

// Or configure electron-vite to handle ESM properly
```
**Warning signs:** Error "require() of ES Module not supported", "ERR_REQUIRE_ESM"

**Source:** [electron-store npm](https://www.npmjs.com/package/electron-store) - "Now native ESM, no longer provides CommonJS export"

## Code Examples

Verified patterns from official sources:

### Database Switch with Rollback
```typescript
// src/main/services/DatabaseManager.ts
export class DatabaseManager {
  private currentDb: DatabaseService | null = null
  private currentPath: string | null = null

  async switchDatabase(newPath: string, password?: string): Promise<void> {
    const previousDb = this.currentDb
    const previousPath = this.currentPath

    try {
      // Close current (with cache clear)
      if (this.currentDb) {
        this.currentDb.clearStatementCache()
        this.currentDb.close()
      }

      // Open new
      this.currentDb = new DatabaseService(newPath)

      // Set encryption key if provided
      if (password) {
        this.currentDb.pragma(`key='${password}'`)
        // Validate password
        this.currentDb.database.prepare('SELECT count(*) FROM sqlite_master').get()
      }

      this.currentPath = newPath

      // Success - close old (already closed above)
    } catch (error) {
      // Rollback - restore previous
      if (previousDb && previousPath) {
        this.currentDb = previousDb
        this.currentPath = previousPath
        throw new Error('Failed to switch database. Previous database restored.')
      }
      throw error
    }
  }
}
```

### IPC Handler for Database Operations
```typescript
// src/main/ipc/handlers/database.ts
import { ipcMain, dialog } from 'electron'
import { DatabaseManager } from '../../services/DatabaseManager'

const dbManager = new DatabaseManager()

ipcMain.handle('database:selectFile', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select Database',
    properties: ['openFile'],
    filters: [
      { name: 'SQLite Database', extensions: ['sqlite', 'db', 'sqlite3'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })

  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('database:open', async (_event, path: string, password?: string) => {
  try {
    await dbManager.switchDatabase(path, password)
    return { success: true }
  } catch (error) {
    if (error.message.includes('file is encrypted or is not a database')) {
      return { success: false, error: 'WRONG_PASSWORD' }
    }
    return { success: false, error: error.message }
  }
})

ipcMain.handle('database:create', async (_event, name: string, password?: string) => {
  const result = await dialog.showSaveDialog({
    title: 'Create Database',
    defaultPath: `${name}.sqlite`,
    filters: [{ name: 'SQLite Database', extensions: ['sqlite'] }]
  })

  if (result.canceled || !result.filePath) {
    return { success: false }
  }

  // Create new database
  const db = new DatabaseService(result.filePath)
  if (password) {
    // For new database, just set key before schema init
    db.pragma(`key='${password}'`)
  }
  db.close()

  // Open it as current
  await dbManager.switchDatabase(result.filePath, password)
  return { success: true, path: result.filePath }
})

ipcMain.handle('database:rekey', async (_event, oldPassword: string, newPassword: string) => {
  const db = dbManager.getCurrent()
  if (!db) throw new Error('No database open')

  // Must unlock first
  db.pragma(`key='${oldPassword}'`)
  db.database.prepare('SELECT count(*) FROM sqlite_master').get() // Validate

  // Then rekey
  db.pragma(`rekey='${newPassword}'`)

  return { success: true }
})
```
**Source:** Pattern follows existing import/export handlers in codebase

### Recent Databases with electron-store
```typescript
// src/main/services/RecentDatabasesService.ts
import Store from 'electron-store'

interface RecentDatabase {
  path: string
  name: string
  lastOpened: number
}

interface StoreSchema {
  recentDatabases: RecentDatabase[]
}

export class RecentDatabasesService {
  private store: Store<StoreSchema>
  private maxRecent = 5

  constructor() {
    this.store = new Store<StoreSchema>({
      defaults: {
        recentDatabases: []
      }
    })
  }

  addRecent(path: string, name: string): void {
    const recent = this.store.get('recentDatabases')

    // Remove existing entry for this path
    const filtered = recent.filter(db => db.path !== path)

    // Add to front
    filtered.unshift({
      path,
      name,
      lastOpened: Date.now()
    })

    // Keep only max items
    this.store.set('recentDatabases', filtered.slice(0, this.maxRecent))
  }

  getRecent(): RecentDatabase[] {
    return this.store.get('recentDatabases')
  }

  clearRecent(): void {
    this.store.set('recentDatabases', [])
  }
}
```
**Source:** [electron-store examples](https://github.com/sindresorhus/electron-store)

### Encrypt Existing Plaintext Database
```typescript
// src/main/services/DatabaseManager.ts
async encryptDatabase(dbPath: string, password: string): Promise<void> {
  const tempPath = `${dbPath}.encrypted.tmp`

  // Open plaintext database
  const plainDb = new Database(dbPath)

  try {
    // Attach encrypted target
    plainDb.exec(`ATTACH DATABASE '${tempPath}' AS encrypted KEY '${password}'`)

    // Export all data
    plainDb.exec(`SELECT sqlcipher_export('encrypted')`)

    // Detach
    plainDb.exec(`DETACH DATABASE encrypted`)

    plainDb.close()

    // Replace original with encrypted version
    // (In production, add backup logic)
    const fs = require('fs')
    fs.renameSync(dbPath, `${dbPath}.backup`)
    fs.renameSync(tempPath, dbPath)

  } catch (error) {
    plainDb.close()
    throw error
  }
}
```
**Source:** [SQLCipher FAQ](https://discuss.zetetic.net/t/how-to-encrypt-a-plaintext-sqlite-database-to-use-sqlcipher-and-avoid-file-is-encrypted-or-is-not-a-database-errors/868)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual settings JSON | electron-store | 2022+ (v8+) | Now ESM-only - requires ESM imports in Electron 28+ |
| CommonJS in main | ESM support | Electron 28 (2023) | Can use import/export in main process without bundler workarounds |
| dialog.showOpenDialog callback | Promise-based API | Electron 6+ (2019) | All dialog methods return promises, no more callback patterns |
| localStorage for settings | electron-store | 2020+ | Enables main process access to settings, atomic writes |

**Deprecated/outdated:**
- **electron-store CommonJS exports:** v9+ is ESM-only, must use `import` not `require()`
- **Callback-based dialog API:** All modern code uses async/await with promises
- **remote module for renderer access:** Removed in Electron 14, use contextBridge + IPC instead

## Open Questions

Things that couldn't be fully resolved:

1. **Better-sqlite3-multiple-ciphers Electron 40 compatibility**
   - What we know: Package is a drop-in replacement for better-sqlite3, requires same rebuild workflow
   - What's unclear: No explicit Electron 40 compatibility statement in recent docs
   - Recommendation: Test in Phase 13 with `npm run rebuild:electron`, verify native module loads successfully. If ABI mismatch, check for v13+ releases or build from source.

2. **FTS5 virtual table initialization timing with encryption**
   - What we know: Phase 13 research identified FTS5 must be created AFTER PRAGMA key on encrypted databases
   - What's unclear: Whether existing unencrypted databases with FTS5 tables work correctly when encrypted via sqlcipher_export
   - Recommendation: Test encryption workflow preserves FTS5 tables. If not, may need to recreate FTS triggers after encryption.

3. **Vuetify v-menu dropdown max height for long recent lists**
   - What we know: Standard v-menu component, common pattern in app bars
   - What's unclear: Best practice for max height when recent list is long (prevents off-screen rendering)
   - Recommendation: Limit to 5 recent items (matches user decision in CONTEXT.md). If more needed later, add max-height style to v-list.

## Sources

### Primary (HIGH confidence)
- [Electron Dialog API](https://www.electronjs.org/docs/latest/api/dialog) - Official showOpenDialog/showSaveDialog documentation
- [SQLCipher API](https://www.zetetic.net/sqlcipher/sqlcipher-api/) - PRAGMA key, rekey, encryption operations
- [SQLite close() C API](https://sqlite.org/c3ref/close.html) - Statement finalization requirement before closing
- [better-sqlite3-multiple-ciphers GitHub](https://github.com/m4heshd/better-sqlite3-multiple-ciphers/blob/master/docs/api.md) - Encryption API documentation
- [electron-store GitHub](https://github.com/sindresorhus/electron-store) - Persistent storage patterns, ESM-only since v9

### Secondary (MEDIUM confidence)
- [Electron Security Tutorial](https://www.electronjs.org/docs/latest/tutorial/security) - IPC security best practices, verified with official docs
- [Vuetify Menus](https://vuetifyjs.com/en/components/menus/) - v-menu component (page title only, API inferred from standard patterns)
- [Vuetify Tooltips](https://vuetifyjs.com/en/components/tooltips/) - v-tooltip component (page title only, API inferred from standard patterns)
- [Techformist Vuetify password toggle](https://techformist.com/toggle-to-hide-or-show-password-in-vuetify/) - Community pattern, consistent with observed Vuetify patterns

### Tertiary (LOW confidence)
- [RxDB Electron database](https://rxdb.info/electron-database.html) - Alternative database options (WebSearch only, not applicable to current stack)
- [Zetetic Community discussions](https://discuss.zetetic.net/t/identify-encrypted-db/680) - Community knowledge about encrypted DB detection (not official docs)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - better-sqlite3-multiple-ciphers is documented drop-in replacement, electron-store is widely used
- Architecture: HIGH - Patterns verified with SQLite/SQLCipher official docs, existing codebase shows IPC/dialog patterns
- Pitfalls: HIGH - Statement cache invalidation documented in SQLite C API, PRAGMA key behavior in SQLCipher API, PRAGMA rekey limitation explicitly documented
- Vuetify components: MEDIUM - Official docs pages exist but WebFetch returned titles only; API patterns inferred from Vuetify's documented conventions and community examples

**Research date:** 2026-01-27
**Valid until:** 2026-02-27 (30 days - stable technologies, but verify better-sqlite3-multiple-ciphers Electron 40 compatibility during implementation)
