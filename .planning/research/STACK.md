# Technology Stack: v0.3.0 Additions

**Project:** Varlens
**Researched:** 2026-01-27
**Scope:** New dependencies for SQLCipher encryption, ZIP extraction, cohort aggregation, and external links

## Recommended Stack Additions

### Database Encryption: better-sqlite3-multiple-ciphers

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `better-sqlite3-multiple-ciphers` | ^12.6.2 | Drop-in replacement for `better-sqlite3` with encryption support | API-compatible fork of better-sqlite3 that bundles SQLite3MultipleCiphers. Supports SQLCipher and 5 other cipher schemes. Prebuilt binaries available for Electron v29-v40 (our target is Electron 40). Eliminates the historically painful SQLCipher+Electron compilation dance. |

**Confidence:** HIGH -- verified via GitHub releases (v12.6.2, January 19, 2026) confirming Electron v40 prebuilt support.

#### Migration from better-sqlite3

This is the single most impactful stack change. `better-sqlite3-multiple-ciphers` is a direct fork that maintains full API compatibility with `better-sqlite3`. Migration steps:

1. **Replace the dependency:**
   ```bash
   npm uninstall better-sqlite3
   npm install better-sqlite3-multiple-ciphers@^12.6.2
   ```

2. **Update imports** -- every file that imports `better-sqlite3`:
   ```typescript
   // Before
   import Database from 'better-sqlite3'
   import type { Database as DatabaseType } from 'better-sqlite3'

   // After
   import Database from 'better-sqlite3-multiple-ciphers'
   import type { Database as DatabaseType } from 'better-sqlite3'
   // (types still come from @types/better-sqlite3)
   ```

3. **Add TypeScript declaration** for module resolution:
   ```typescript
   // src/main/database/better-sqlite3-multiple-ciphers.d.ts
   declare module 'better-sqlite3-multiple-ciphers' {
     import Database from 'better-sqlite3';
     export = Database;
   }
   ```

4. **Update build configuration** -- `electron.vite.config.ts`:
   ```typescript
   // Change external from 'better-sqlite3' to 'better-sqlite3-multiple-ciphers'
   external: ['better-sqlite3-multiple-ciphers']
   ```

5. **Update package.json build config:**
   - `asarUnpack`: change `better-sqlite3` to `better-sqlite3-multiple-ciphers`
   - `files`: change `better-sqlite3` to `better-sqlite3-multiple-ciphers`
   - `postinstall` and `rebuild:electron`: change `-w better-sqlite3` to `-w better-sqlite3-multiple-ciphers`
   - `rebuild:node`: change to `npm rebuild better-sqlite3-multiple-ciphers`

6. **Enable encryption** in DatabaseService constructor:
   ```typescript
   this.db = new Database(dbPath)
   // For SQLCipher-compatible encryption:
   this.db.pragma("cipher='sqlcipher'")
   this.db.pragma("legacy=4")
   this.db.pragma(`key='${userKey}'`)
   ```

#### Cipher Scheme Recommendation

Use **SQLCipher (legacy=4)** mode because:
- Industry standard for encrypted SQLite in biomedical/genomic tools
- Compatible with DB Browser for SQLite (users can verify database externally)
- AES-256 encryption meets regulatory expectations for genetic data
- The `legacy=4` setting is compatible with SQLCipher 4.x databases

Do NOT use the default `sqleet` cipher (ChaCha20) because:
- Less recognized in the genomics/biomedical community
- No external tool compatibility (cannot open in DB Browser for SQLite)
- Marginal performance benefit is irrelevant for this use case

#### Existing Database Migration Strategy

When users upgrade from v0.2.0 (unencrypted) to v0.3.0 (encrypted):
- Detect unencrypted database on startup (try opening without key, if succeeds, it is unencrypted)
- Prompt user to set encryption password
- Use `PRAGMA rekey='new-password'` to encrypt in-place
- This is a built-in feature of SQLite3MultipleCiphers -- no manual export/import needed

#### Native Module Rebuild Implications

The rebuild workflow changes from `better-sqlite3` to `better-sqlite3-multiple-ciphers` but the process is identical:

```bash
# postinstall (for Electron)
npx @electron/rebuild -f -w better-sqlite3-multiple-ciphers

# For Node.js tests
npm rebuild better-sqlite3-multiple-ciphers

# For Electron packaging
npx @electron/rebuild -f -w better-sqlite3-multiple-ciphers
```

The prebuilt binaries for Electron v40 are confirmed available (v12.6.2 release notes), so compilation from source should not be required on any platform.

**Windows note:** Same Visual Studio Build Tools requirement as before (only needed if prebuilts fail).

---

### ZIP Extraction: unzipper

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `unzipper` | ^0.12.3 | Extract files from password-protected ZIP archives | Pure JavaScript, streaming API, supports ZipCrypto password protection. 1,697 dependent projects on npm. No native dependencies -- critical for cross-platform Electron. |

**Confidence:** MEDIUM -- unzipper supports ZipCrypto passwords but does NOT support AES-256 encrypted ZIPs (open issue #86). This is acceptable IF the upstream ZIP creator uses ZipCrypto, which is the standard for password-protected ZIPs created by most tools. If AES-256 is required, see alternatives below.

#### Usage Pattern for Varlens

```typescript
import * as unzipper from 'unzipper'

async function extractFromZip(zipPath: string, password: string): Promise<string[]> {
  const directory = await unzipper.Open.file(zipPath)
  const extractedPaths: string[] = []

  for (const file of directory.files) {
    if (file.path.endsWith('.json.gz')) {
      const content = await file.buffer(password)
      // Write to temp directory, then feed to existing ImportService
      const tempPath = join(tempDir, file.path)
      writeFileSync(tempPath, content)
      extractedPaths.push(tempPath)
    }
  }

  return extractedPaths
}
```

#### Integration with Existing Import Pipeline

The ZIP extraction is a **pre-processing step** before the existing `ImportService`. The pipeline becomes:

```
ZIP file (password-protected)
  --> unzipper extracts .json.gz files to temp directory
  --> existing ImportService processes each .json.gz file
  --> temp files cleaned up
```

This approach requires NO changes to `ImportService` itself. The ZIP handling is a new layer above it.

#### AES-256 Alternative (if needed)

If AES-256 ZIP encryption is required:

| Library | AES-256 | ZipCrypto | Pure JS | Streaming |
|---------|---------|-----------|---------|-----------|
| `unzipper` | No | Yes | Yes | Yes |
| `@zip.js/zip.js` | Yes | Yes | Yes | Yes |
| 7-Zip child process | Yes | Yes | No (native) | No |

**Recommendation:** Start with `unzipper` (simpler API, streaming, battle-tested). If AES-256 becomes a requirement, switch to `@zip.js/zip.js` (v2.7.x, ~1.8M weekly downloads, supports both browser and Node.js, supports AES-256 + ZipCrypto).

---

### Cohort Aggregation: No New Dependencies

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| SQLite (existing) | -- | Cross-case variant aggregation queries | SQLite's `GROUP BY`, `COUNT`, `AVG`, window functions, and CTEs are sufficient for cohort statistics. No ORM or query builder needed. |

**Confidence:** HIGH -- this is purely a SQL query design task, not a library choice.

#### Aggregation Query Patterns

Cohort analysis requires queries across multiple cases. Key query patterns:

```sql
-- Variant frequency across cases in a cohort
SELECT chr, pos, ref, alt, gene_symbol,
       COUNT(DISTINCT case_id) as case_count,
       COUNT(DISTINCT case_id) * 1.0 / :total_cases as cohort_frequency,
       AVG(gnomad_af) as avg_gnomad_af,
       GROUP_CONCAT(DISTINCT clinvar) as clinvar_values
FROM variants
WHERE case_id IN (SELECT id FROM cases WHERE id IN (:case_ids))
GROUP BY chr, pos, ref, alt
ORDER BY case_count DESC;

-- Per-gene variant burden across cohort
SELECT gene_symbol,
       COUNT(*) as total_variants,
       COUNT(DISTINCT case_id) as affected_cases,
       SUM(CASE WHEN consequence IN ('missense_variant', 'frameshift_variant', 'stop_gained') THEN 1 ELSE 0 END) as damaging_count
FROM variants
WHERE case_id IN (:case_ids)
GROUP BY gene_symbol
ORDER BY affected_cases DESC;
```

#### Performance Considerations

For cohort queries spanning many cases:
- Add index: `CREATE INDEX idx_variants_chr_pos_ref_alt ON variants(chr, pos, ref, alt)` -- enables fast grouping by variant identity
- Add index: `CREATE INDEX idx_variants_gene_consequence ON variants(gene_symbol, consequence)` -- enables fast gene burden queries
- Consider materializing cohort views if >50 cases: use SQLite temp tables or application-level caching
- SQLite can handle hundreds of thousands of variants across dozens of cases on desktop hardware without issues

#### Schema Addition for Cohorts

A new `cohorts` table to group cases:

```sql
CREATE TABLE IF NOT EXISTS cohorts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cohort_cases (
  cohort_id INTEGER NOT NULL,
  case_id INTEGER NOT NULL,
  PRIMARY KEY (cohort_id, case_id),
  FOREIGN KEY (cohort_id) REFERENCES cohorts(id) ON DELETE CASCADE,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);
```

---

### External Links: No New Dependencies

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Electron `shell.openExternal()` | (built-in) | Open URLs in default browser | Already available via Electron API. The app already has a shell IPC handler (`src/main/ipc/handlers/shell.ts`). |

**Confidence:** HIGH -- URL construction is string manipulation, no libraries needed.

#### URL Templates for Variant Databases

These are the verified URL formats for external variant database links:

**ClinVar** (verified via [official linking docs](https://www.ncbi.nlm.nih.gov/clinvar/docs/linking/)):
```typescript
// By ClinVar Variation ID (if available in data)
const clinvarByVariationId = (variationId: string) =>
  `https://www.ncbi.nlm.nih.gov/clinvar/variation/${variationId}/`

// By genomic coordinates (always constructible from variant data)
const clinvarByCoords = (chr: string, pos: number, ref: string, alt: string) =>
  `https://www.ncbi.nlm.nih.gov/clinvar/?term=${chr}[chr]+AND+${pos}[chrpos38]`

// By gene symbol
const clinvarByGene = (geneSymbol: string) =>
  `https://www.ncbi.nlm.nih.gov/clinvar/?term=${geneSymbol}[sym]`
```

**gnomAD** (verified via [gnomAD browser](https://gnomad.broadinstitute.org/)):
```typescript
// Variant page -- chr without "chr" prefix, hyphen-separated
// Format: CHROM-POS-REF-ALT
const gnomadVariant = (chr: string, pos: number, ref: string, alt: string, dataset = 'gnomad_r4') =>
  `https://gnomad.broadinstitute.org/variant/${chr}-${pos}-${ref}-${alt}?dataset=${dataset}`

// Gene page
const gnomadGene = (geneSymbol: string, dataset = 'gnomad_r4') =>
  `https://gnomad.broadinstitute.org/gene/${geneSymbol}?dataset=${dataset}`
```

**OMIM** (verified via [OMIM linking help](https://www.omim.org/help/linking)):
```typescript
// By MIM number (6-digit ID)
const omimEntry = (mimNumber: string) =>
  `https://omim.org/entry/${mimNumber}`

// Search by gene symbol
const omimSearch = (geneSymbol: string) =>
  `https://omim.org/search?index=geneMap&search=${encodeURIComponent(geneSymbol)}`
```

**Additional useful databases** (no new dependencies, just URL templates):
```typescript
// UCSC Genome Browser
const ucscBrowser = (chr: string, pos: number, ref: string, alt: string) => {
  const end = pos + Math.max(ref.length, alt.length)
  return `https://genome.ucsc.edu/cgi-bin/hgTracks?db=hg38&position=chr${chr}:${pos}-${end}`
}

// Ensembl VEP (by variant notation)
const ensemblVariant = (chr: string, pos: number, ref: string, alt: string) =>
  `https://www.ensembl.org/Homo_sapiens/Tools/VEP/Results?v=${chr}_${pos}_${ref}/${alt}`

// VarSome (third-party variant aggregator)
const varsome = (chr: string, pos: number, ref: string, alt: string) =>
  `https://varsome.com/variant/hg38/chr${chr}-${pos}-${ref}-${alt}`
```

#### Implementation Pattern

Create a `src/shared/externalLinks.ts` utility module:
- Pure functions, no side effects
- Each function takes variant fields, returns a URL string
- Renderer calls these functions and opens URLs via existing `shell:openExternal` IPC

---

### Database Selection/Switching: No New Dependencies

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Electron `dialog.showOpenDialog()` | (built-in) | File picker for .db files | Already available. Need to extend DatabaseService to support re-initialization with different paths. |
| Node.js `fs` | (built-in) | File existence checks, path operations | Standard library. |

**Confidence:** HIGH -- this is an architecture change to DatabaseService, not a dependency addition.

#### Implementation Approach

The current `DatabaseService` is a singleton initialized once. For database switching:

1. Add `closeDatabaseService()` call (already exists in `src/main/database/index.ts`)
2. Re-create singleton with new path
3. Emit IPC event to renderer to refresh all data
4. Store recently-used database paths in Electron `Store` or a JSON config file

If persistent settings are needed for "recent databases" list, consider:

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `electron-store` | ^10.0.0 | Persist app settings (recent DBs, preferences) | Simple key-value JSON store for Electron apps. 2.5M+ weekly downloads. Used by many Electron apps for preferences. |

**Confidence:** MEDIUM -- `electron-store` is well-established but I have not verified the exact latest version. The alternative is writing a simple JSON file with `fs.writeFileSync` which avoids adding a dependency.

**Recommendation:** For v0.3.0, use a simple JSON config file in `app.getPath('userData')`. Only add `electron-store` if settings complexity grows beyond a few keys.

---

## What NOT to Add

| Library/Approach | Why Not |
|------------------|---------|
| `node-sqlcipher` / `@journeyapps/sqlcipher` | Async API, completely different from better-sqlite3. Would require rewriting the entire database layer. |
| `better-sqlite3-sqlcipher` | Forked from better-sqlite3 v5.4.3 (ancient). Uses SQLCipher v4.1.0 + OpenSSL v1.0.2s. Unmaintained. |
| `sql.js` (Emscripten-compiled SQLite) | WASM-based, poor performance for large datasets, no native file I/O, incompatible with existing prepared statement caching approach. |
| `knex` / `typeorm` / any ORM | Overkill for this app. The existing raw SQL approach with prepared statement caching is faster and more appropriate for a desktop app with a fixed schema. |
| `adm-zip` | Loads entire ZIP into memory. Not suitable for large genomic data archives. |
| `archiver` / `archiver-zip-encrypted` | For CREATING zips, not extracting. We only need extraction. |
| `7-Zip child process` | Platform-specific binary dependency. Defeats the purpose of a cross-platform Electron app. |
| Any HTTP client for external links | External links open in the browser. The app does NOT need to fetch data from ClinVar/gnomAD/OMIM APIs. Just construct URLs and open them. |
| `node-fetch` / `axios` for OMIM API | OMIM API requires registration and yearly key renewal. Not appropriate for an offline desktop tool. Link to the web UI instead. |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Database encryption | `better-sqlite3-multiple-ciphers` | `@journeyapps/sqlcipher` | Async API, different from existing code |
| Database encryption | `better-sqlite3-multiple-ciphers` | `better-sqlite3-sqlcipher` | Unmaintained, based on v5.4.3 |
| ZIP extraction | `unzipper` | `@zip.js/zip.js` | More complex API; only needed if AES-256 required |
| ZIP extraction | `unzipper` | `adm-zip` | Loads entire file into memory |
| Cohort queries | Raw SQL | `knex` query builder | Unnecessary abstraction layer |
| External links | URL string templates | API clients | Offline app, just needs browser URLs |
| Settings storage | JSON file (fs) | `electron-store` | Avoid dependency for simple needs |

---

## Installation Summary

```bash
# Remove old dependency
npm uninstall better-sqlite3

# Add new dependencies
npm install better-sqlite3-multiple-ciphers@^12.6.2
npm install unzipper@^0.12.3

# Dev dependencies (unchanged, @types/better-sqlite3 still works)
# No new dev dependencies needed
```

Total new runtime dependencies: **2** (`better-sqlite3-multiple-ciphers` replaces `better-sqlite3`, `unzipper` is net new)

Total net dependency increase: **1** (`unzipper`)

---

## Dependency Impact Summary

| Dependency | Type | Native? | Size Impact | Risk |
|------------|------|---------|-------------|------|
| `better-sqlite3-multiple-ciphers` | Replacement | Yes (C++) | Similar to better-sqlite3 (slightly larger due to cipher code) | LOW -- same build process, prebuilts available for Electron 40 |
| `unzipper` | New | No (pure JS) | Small (~50KB + fflate dep) | LOW -- well-maintained, 1,697 dependents |

---

## Sources

- [better-sqlite3-multiple-ciphers npm](https://www.npmjs.com/package/better-sqlite3-multiple-ciphers)
- [better-sqlite3-multiple-ciphers GitHub](https://github.com/m4heshd/better-sqlite3-multiple-ciphers) -- verified v12.6.2 with Electron v40 prebuilds (January 19, 2026)
- [better-sqlite3-multiple-ciphers releases](https://github.com/m4heshd/better-sqlite3-multiple-ciphers/releases) -- confirmed Electron v29-v40 prebuilt support
- [better-sqlite3-multiple-ciphers API docs](https://github.com/m4heshd/better-sqlite3-multiple-ciphers/blob/master/docs/api.md)
- [SQLite3 Multiple Ciphers documentation](https://utelle.github.io/SQLite3MultipleCiphers/)
- [unzipper npm](https://www.npmjs.com/package/unzipper) -- v0.12.3
- [unzipper AES-256 issue #86](https://github.com/ZJONSSON/node-unzipper/issues/86) -- AES-256 not supported
- [@zip.js/zip.js](https://gildas-lormeau.github.io/zip.js/) -- AES-256 alternative if needed
- [ClinVar linking documentation](https://www.ncbi.nlm.nih.gov/clinvar/docs/linking/) -- verified URL formats
- [OMIM linking help](https://www.omim.org/help/linking) -- verified URL format `https://omim.org/entry/{MIM_NUMBER}`
- [gnomAD browser](https://gnomad.broadinstitute.org/) -- verified URL format `https://gnomad.broadinstitute.org/variant/{CHROM}-{POS}-{REF}-{ALT}?dataset=gnomad_r4`
