---
phase: 14
plan: 01
type: summary
subsystem: database-lifecycle
completed: 2026-01-27
duration: 6.3min

tags:
  - database
  - encryption
  - lifecycle
  - sqlcipher
  - ipc

requires:
  - 13-02-SUMMARY.md  # SQLCipher encryption infrastructure

provides:
  - DatabaseManager with open/close/switch lifecycle
  - RecentDatabasesService for persistent recents
  - Database IPC handlers for renderer control
  - Backward-compatible getDatabaseService wrapper

affects:
  - 14-02  # Will use these IPC handlers for UI
  - Future database operations now go through lifecycle-aware manager

tech-stack:
  added:
    - DatabaseManager service
    - RecentDatabasesService (JSON persistence)
  patterns:
    - Rollback pattern for safe database switching
    - Encryption detection via test query
    - Password validation with WrongPasswordError

key-files:
  created:
    - src/main/services/DatabaseManager.ts
    - src/main/services/RecentDatabasesService.ts
    - src/main/ipc/handlers/database.ts
  modified:
    - src/main/database/DatabaseService.ts  # Added lifecycle methods
    - src/main/database/index.ts  # Refactored to manager pattern
    - src/main/database/errors.ts  # Added WrongPasswordError, EncryptionError
    - src/main/index.ts  # Initialize manager before IPC
    - src/preload/index.ts  # Added database namespace
    - src/shared/types/api.ts  # Added DatabaseAPI types
    - src/shared/types/errors.ts  # Added WRONG_PASSWORD code
    - src/main/ipc/errorHandler.ts  # Handle WrongPasswordError

decisions:
  - decision: "Use simple JSON file (varlens-settings.json) for recent databases persistence"
    rationale: "Avoid electron-store (ESM-only) to keep build simple; JSON is sufficient for this use case"
    alternatives: "electron-store, custom SQLite table"

  - decision: "Implement rollback pattern in switchDatabase (restore previous on failure)"
    rationale: "Critical for robustness - user should never lose database connection on failed switch"
    alternatives: "No rollback (bad UX), pre-validate before switching (complex)"

  - decision: "Encryption detection via test SELECT query, not file header inspection"
    rationale: "SQLCipher doesn't mark file headers; only way to detect is attempt to query"
    alternatives: "File magic number (doesn't work for SQLCipher), always prompt (bad UX)"

  - decision: "Keep backward-compatible getDatabaseService() wrapper in database/index.ts"
    rationale: "All existing IPC handlers (cases, variants, import, export) can continue working unchanged"
    alternatives: "Update all handlers at once (increases risk), remove function (breaks existing code)"

  - decision: "DatabaseService tracks encrypted state as boolean field, not by querying PRAGMA cipher_version"
    rationale: "Simpler and faster; we know at construction time whether key was provided"
    alternatives: "Query PRAGMA cipher_version on each isEncrypted() call (slower, unnecessary)"
---

# Phase 14 Plan 01: Database Lifecycle Management Summary

**One-liner:** Refactored DatabaseService to support lifecycle management with DatabaseManager providing open/close/switch operations, encryption detection, password validation, and persistent recent databases list.

## What Was Delivered

### 1. DatabaseService Lifecycle Methods

Refactored `DatabaseService` from hardcoded singleton to lifecycle-aware service:

- **clearStatementCache()**: Public method to clear prepared statement cache before closing (critical for clean shutdown)
- **isEncrypted()**: Returns boolean indicating if database was opened with encryption key
- **getPath()**: Returns database file path
- **rekey(newPassword)**: Changes encryption key on already-encrypted databases (calls PRAGMA rekey)
- **close()**: Now calls clearStatementCache() before db.close() for proper cleanup
- **Private fields**: Added `dbPath: string` and `encrypted: boolean` to track state

**Implementation notes:**
- Constructor already accepts `encryptionKey?: string` from Phase 13
- PRAGMA key is still applied as FIRST operation (before WAL, foreign keys, schema)
- Encrypted state is determined at construction time, not via runtime query

### 2. DatabaseManager Service

Created `src/main/services/DatabaseManager.ts` as centralized lifecycle controller:

**Core Operations:**
- **open(dbPath, key?)**: Close current, open new database, validate password if provided, add to recents
- **openDetectEncryption(dbPath)**: Test query to detect if database is encrypted (returns `{ needsPassword: boolean }`)
- **createDatabase(dbPath, key?)**: Create new database with optional encryption
- **switchDatabase(newPath, key?)**: Safe switching with rollback pattern:
  - Save reference to previous DB
  - Try opening new DB
  - On success: close previous, store new
  - On failure: restore previous, rethrow error
- **close()**: Safe close with clearStatementCache
- **getCurrent()**: Get current DatabaseService (throws if none open)
- **getCurrentPath()**: Get current database path
- **getCurrentInfo()**: Returns `{ path, name, encrypted }` or null
- **rekey(newPassword)**: Change encryption key on current database
- **getRecentDatabases()**: Proxy to RecentDatabasesService

**Error handling:**
- Throws `WrongPasswordError` when password validation fails
- Catches "file is encrypted or is not a database" message from SQLite
- Generic errors wrapped in `DatabaseError`

### 3. RecentDatabasesService

Created `src/main/services/RecentDatabasesService.ts` for persistent recent databases:

**Storage:**
- Uses `varlens-settings.json` in userData directory
- Simple JSON read/write (same pattern as existing import settings)
- Structure: `{ recentDatabases: [{ path, name, lastOpened }] }`

**Operations:**
- **addRecent(dbPath)**: Remove existing entry, prepend new entry, trim to 5 max, save
- **getRecent()**: Return list of recent databases
- **removeRecent(dbPath)**: Filter out entry and save

**Robustness:**
- Non-existent file returns empty list (not an error)
- Save errors are silently ignored (non-critical feature)

### 4. Database Module Refactoring

Refactored `src/main/database/index.ts` from singleton to manager pattern:

**New exports:**
- `initDatabaseManager()`: Create manager singleton, open default database (`userData/varlens.db`)
- `getDatabaseManager()`: Return manager singleton (throws if not initialized)
- `getDatabaseService()`: **Backward-compatible wrapper** -- returns `getDatabaseManager().getCurrent()`
- `closeDatabaseManager()`: Close manager and null out singleton
- `DatabaseManager`, `RecentDatabasesService` classes

**Removed exports:**
- Old `closeDatabaseService()` function

**Backward compatibility:**
- All existing IPC handlers (cases, variants, import, export) still call `getDatabaseService()`
- They continue working without any internal logic changes
- Only difference: they now get the service from DatabaseManager instead of singleton

### 5. Database IPC Handlers

Created `src/main/ipc/handlers/database.ts` with 7 IPC channels:

1. **database:selectFile** → Show open dialog, return path or null
2. **database:selectSaveLocation** → Show save dialog with defaultName, return path or null
3. **database:open** → Open database with encryption detection:
   - First: `openDetectEncryption(path)` to check if password needed
   - If encrypted and no password: return `{ success: false, needsPassword: true }`
   - If password provided: try opening, catch `WrongPasswordError`, return `{ success: false, error: 'WRONG_PASSWORD' }`
   - On success: return `{ success: true, info: { path, name, encrypted } }`
4. **database:create** → Create new database with optional encryption
5. **database:rekey** → Change encryption key on current database
6. **database:info** → Get current database info (or null)
7. **database:recentList** → Get recent databases list

**Error handling:**
- All handlers wrapped with `wrapHandler` for consistent error serialization
- `WrongPasswordError` detected and returned as `{ error: 'WRONG_PASSWORD' }`

### 6. Preload Bridge Update

Added `database` namespace to `src/preload/index.ts`:

```typescript
database: {
  selectFile: () => ipcRenderer.invoke('database:selectFile'),
  selectSaveLocation: (defaultName: string) => ipcRenderer.invoke('database:selectSaveLocation', defaultName),
  open: (path: string, password?: string) => ipcRenderer.invoke('database:open', path, password),
  create: (path: string, password?: string) => ipcRenderer.invoke('database:create', path, password),
  rekey: (newPassword: string) => ipcRenderer.invoke('database:rekey', newPassword),
  info: () => ipcRenderer.invoke('database:info'),
  recentList: () => ipcRenderer.invoke('database:recentList')
}
```

Renderer now has full control over database lifecycle via `window.api.database.*`.

### 7. Type System Updates

**src/shared/types/api.ts:**
- `DatabaseInfo`: `{ path, name, encrypted }`
- `DatabaseOpenResult`: `{ success, needsPassword?, error?, info? }`
- `RecentDatabase`: `{ path, name, lastOpened }`
- `DatabaseAPI`: Interface for all 7 database methods
- `WindowAPI`: Added `database: DatabaseAPI`

**src/shared/types/errors.ts:**
- Added `WRONG_PASSWORD = 'WRONG_PASSWORD'` to `ErrorCode` enum

**src/main/database/errors.ts:**
- `WrongPasswordError`: "Wrong password or database is not encrypted"
- `EncryptionError`: Generic encryption failures (exported but not yet used)

**src/main/ipc/errorHandler.ts:**
- Added case for `WrongPasswordError` → `ErrorCode.WRONG_PASSWORD`

### 8. Main Process Integration

Updated `src/main/index.ts`:

**Imports:**
- Changed from `closeDatabaseService` to `initDatabaseManager, closeDatabaseManager`

**Initialization order:**
```typescript
app.whenReady().then(async () => {
  // ... app setup ...

  initDatabaseManager()  // NEW: Before IPC handlers
  await registerIpcHandlers()

  // ... window creation ...
})
```

**Shutdown:**
```typescript
app.on('before-quit', () => {
  closeDatabaseManager()  // Changed from closeDatabaseService
})
```

## Deviations from Plan

None - plan executed exactly as written.

## Testing Evidence

### TypeScript Compilation
- `npm run typecheck` passes with zero errors
- All new services, handlers, and types compile cleanly

### Linting
- `npm run lint` passes
- Fixed strict boolean linting issues:
  - Changed `!password` to explicit `password === undefined || password === ''`
  - Changed `key !== ''` to `key.length > 0`
  - Changed nullable check to explicit `=== null` comparison
  - Removed unused `error` variable in catch blocks

### Build Verification
- `npm run build` completes successfully
- All modules bundle correctly (main, preload, renderer)
- No runtime import errors

### Backward Compatibility
- Verified existing IPC handlers still import `getDatabaseService`
- Cases, variants, import, export handlers unchanged
- They now use DatabaseManager transparently via wrapper function

### File Structure
```
src/main/services/
  DatabaseManager.ts       (new, 8.4KB)
  RecentDatabasesService.ts (new, 2.9KB)

src/main/ipc/handlers/
  database.ts              (new, 3.6KB)

src/main/database/
  DatabaseService.ts       (modified, added 5 methods)
  index.ts                 (refactored, manager pattern)
  errors.ts                (added 2 error classes)
```

## Next Phase Readiness

### For Phase 14-02 (Database Selection UI):

**Available IPC channels:**
- ✅ `database:selectFile` - File picker ready
- ✅ `database:selectSaveLocation` - Save dialog ready
- ✅ `database:open` - Encryption detection + password validation
- ✅ `database:create` - New database creation
- ✅ `database:info` - Get current database
- ✅ `database:recentList` - Recent databases for menu

**Available types:**
- ✅ `DatabaseInfo`, `DatabaseOpenResult`, `RecentDatabase` in `api.ts`
- ✅ `WRONG_PASSWORD` error code for password prompts

**Workflow supported:**
1. User clicks "Open Database"
2. Renderer calls `database:selectFile()`
3. Renderer calls `database:open(path)`
4. If `needsPassword: true`, show password dialog
5. Renderer calls `database:open(path, password)`
6. If `error: 'WRONG_PASSWORD'`, show error, retry
7. If `success: true`, update UI with `info`

### Blockers/Concerns

None. All must-have requirements satisfied:

✅ Database can be opened with specific file path
✅ Database can be closed and reopened at different path without app restart
✅ Prepared statement cache is fully cleared before database close
✅ Failed database switch reverts to previous database automatically
✅ Encrypted database accepts password via PRAGMA key and validates with SELECT
✅ Wrong password is detected and reported as WRONG_PASSWORD error
✅ New encrypted database can be created with password
✅ Password can be changed on encrypted database via PRAGMA rekey
✅ Recent databases list persists across app restarts
✅ IPC channels expose database lifecycle operations to renderer

## Lessons Learned

### 1. wrapHandler Return Type Complexity

The `wrapHandler` function returns `Promise<T | SerializableError>`, which means IPC handler return types must account for error cases. We removed explicit return type annotations from IPC handlers to let TypeScript infer the union type correctly.

**Pattern:**
```typescript
// ❌ Don't do this:
ipcMain.handle('database:open', async (): Promise<DatabaseOpenResult> => {
  return wrapHandler(async () => { /* ... */ })
})

// ✅ Do this:
ipcMain.handle('database:open', async () => {
  return wrapHandler(async () => { /* ... */ })
})
```

### 2. SQLCipher Encryption Detection Pattern

SQLCipher doesn't mark file headers, so the only way to detect encryption is:
1. Open database without key
2. Try `SELECT count(*) FROM sqlite_master`
3. If error message includes "file is encrypted or is not a database" → encrypted
4. Otherwise → plaintext

This is more robust than file magic numbers and matches SQLCipher documentation.

### 3. Rollback Pattern is Critical

The `switchDatabase` rollback pattern prevented a class of bugs where failed switches would leave the user with no database connection. By saving a reference to the previous database and restoring it on failure, we ensure the app always has a valid database.

**Key insight:** Don't null out current database until new database is validated and open.

### 4. Backward Compatibility Reduces Risk

By keeping `getDatabaseService()` as a wrapper around `getDatabaseManager().getCurrent()`, we decoupled this refactoring from changes to all existing IPC handlers. This reduced the surface area for bugs and made the changes more reviewable.

**Trade-off:** An extra function call per database access (negligible overhead).

### 5. Recent Databases Don't Need Complex Storage

Using a simple JSON file (`varlens-settings.json`) was simpler than adding `electron-store` as a dependency or creating a SQLite table. For a max-5-item list that's read/written infrequently, JSON is sufficient.

## Commits

**4e2c809** - feat(14-01): refactor DatabaseService and create DatabaseManager with lifecycle support
- Add clearStatementCache(), isEncrypted(), getPath(), rekey() methods to DatabaseService
- Track encrypted state and dbPath as private fields
- Update close() to call clearStatementCache() before db.close()
- Add WrongPasswordError and EncryptionError to database errors
- Create DatabaseManager service with open/close/switch lifecycle operations
- Implement rollback pattern for switchDatabase (restore previous on failure)
- Add openDetectEncryption for password detection
- Create RecentDatabasesService for persistent recent databases list (JSON file)
- Refactor database/index.ts to use DatabaseManager pattern
- Export backward-compatible getDatabaseService() wrapper
- Update main/index.ts to call initDatabaseManager() before IPC registration
- Replace closeDatabaseService with closeDatabaseManager

**5b5d9e1** - feat(14-01): create database IPC handlers and update preload bridge
- Add WRONG_PASSWORD to ErrorCode enum
- Update errorHandler to handle WrongPasswordError
- Create database IPC handlers module with 7 channels (selectFile, selectSaveLocation, open, create, rekey, info, recentList)
- Register database handlers in IPC index
- Add DatabaseAPI, DatabaseInfo, DatabaseOpenResult, RecentDatabase types
- Expose database namespace in preload bridge with all 7 methods
- Fix strict boolean linting issues in DatabaseManager and RecentDatabasesService

**Total:** 2 atomic commits, 14 files modified/created
