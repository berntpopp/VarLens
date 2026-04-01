# VarLens Refactoring Action Plan

**Date:** 2026-04-01 (revised 2026-04-01 after peer review)
**Based on:** Unified code review (Claude + Codex + Gemini) + best-practices research + peer review
**Companion:** [UNIFIED-CODE-REVIEW-2026-04-01.md](UNIFIED-CODE-REVIEW-2026-04-01.md)

---

## Strategy

This plan is organized into 4 phases by priority. Each phase is independently shippable.
Within each phase, tasks are ordered by dependency (do earlier tasks first).

**Guiding principles:**
- Fix correctness bugs before refactoring aesthetics
- Restore quality gates before adding features
- Each task should be a single PR with focused scope
- Prefer incremental migration over big-bang rewrites

---

## Phase 1: Correctness & Security (Priority: CRITICAL)

Fixes that affect analysis results or security boundaries. Do these first.

### 1.1 Fix Genotype Dosage Derivation

**Review finding:** `AssociationDataBuilder.ts:54-61` uses `CAST(COALESCE(gt_num, '0') AS INTEGER)` to derive dosage. VCF import stores GT strings like `0/1`, `1/1`, `0|1`. SQLite integer cast truncates `0/1` to `0`, making all heterozygous calls appear as homozygous reference. Burden/contingency analysis produces wrong results on real imported data.

**What to do:**

The fix must avoid creating two parallel dosage definitions (TS utility + SQL CASE) that can drift. Prefer a **single canonical mapping** used consistently.

**Phase 1 scope (this task): fix the bug with a shared SQL CASE expression.** Import-time normalization (adding a `dosage INTEGER` column to the schema, updating `VcfMapper.ts:75`, `VariantRepository.ts:82`, `schema.ts:35`, writing a backfill migration, and handling compatibility) is a significantly larger change. Move that to a later phase if desired. For now, the SQL CASE fix is sufficient and self-contained.

Use a **single shared SQL CASE expression** as a constant in `src/shared/sql/` that both `AssociationDataBuilder` and any future analytics code reference:

```typescript
// src/shared/sql/genotype-dosage.ts
/** Canonical GT-to-dosage SQL CASE expression for use in queries.
 *  Standard mapping per VCF spec + PLINK/Hail conventions. */
export const GT_DOSAGE_SQL = `
  CASE gt_num
    WHEN '1/1' THEN 2  WHEN '1|1' THEN 2
    WHEN '0/1' THEN 1  WHEN '1/0' THEN 1
    WHEN '0|1' THEN 1  WHEN '1|0' THEN 1
    WHEN '0/0' THEN 0  WHEN '0|0' THEN 0
    WHEN '1'   THEN 1
    WHEN '0'   THEN 0
    ELSE NULL
  END`
```

Also add a TS utility for non-SQL contexts (e.g., test assertions, future streaming paths):

```typescript
// src/shared/utils/genotype.ts
export function gtToDosage(gt: string | null | undefined): number | null {
  if (gt == null) return null
  switch (gt) {
    case '0/0': case '0|0': return 0
    case '0/1': case '1/0': case '0|1': case '1|0': return 1
    case '1/1': case '1|1': return 2
    case '0': return 0
    case '1': return 1
    case './.': case '.|.': case '.': return null
    default: {
      const alleles = gt.split(/[/|]/)
      if (alleles.some(a => a === '.')) return null
      return alleles.filter(a => a !== '0').length
    }
  }
}
```

**Important:** The TS utility and SQL CASE must encode identical mapping. Add a cross-check test that verifies both produce the same result for all standard GT values.

Add tests using real VCF-style GT values (not synthetic numeric fixtures):
- Test heterozygous `0/1` produces dosage 1
- Test homozygous alt `1/1` produces dosage 2
- Test missing `./.` produces NULL (not 0)
- Test haploid `1` produces dosage 1
- Cross-check test: TS utility matches SQL CASE for all standard inputs
- Integration test: import a real VCF, run burden analysis, verify correct dosage distribution

**Files to modify:**
- `src/main/database/AssociationDataBuilder.ts` (use `GT_DOSAGE_SQL`)
- `src/shared/sql/genotype-dosage.ts` (new -- single canonical SQL mapping)
- `src/shared/utils/genotype.ts` (new -- TS utility for non-SQL contexts)
- `tests/main/database/AssociationDataBuilder.test.ts` (new/expanded tests)
- `tests/shared/utils/genotype.test.ts` (new -- TS utility + cross-check)

**References:**
- [VCF v4.3 spec](https://samtools.github.io/hts-specs/VCFv4.3.pdf) -- GT field definition
- PLINK `--dosage` and Hail `n_alt_alleles()` use identical mapping

---

### 1.2 Canonicalize ACMG Classification Labels

**Review finding:** IPC schema accepts `Likely Pathogenic` (title case) but cohort summary SQL compares `Likely pathogenic` (sentence case). Stored values can mismatch summary queries, breaking counts and rankings.

**What to do:**

1. Define the canonical labels in `src/shared/config/domain.config.ts` following ClinVar/ACMG standard:

```typescript
export const ACMG_CLASSIFICATIONS = [
  'Pathogenic',
  'Likely pathogenic',      // ClinVar standard: lowercase 'p'
  'Uncertain significance', // Not 'VUS'
  'Likely benign',          // ClinVar standard: lowercase 'b'
  'Benign',
] as const

export type AcmgClassification = (typeof ACMG_CLASSIFICATIONS)[number]
```

2. Add a normalization function in `src/shared/utils/acmg.ts`:

```typescript
const ACMG_NORMALIZATION: Record<string, AcmgClassification> = {
  'Pathogenic': 'Pathogenic',
  'Likely Pathogenic': 'Likely pathogenic',
  'Likely pathogenic': 'Likely pathogenic',
  'LP': 'Likely pathogenic',
  'VUS': 'Uncertain significance',
  'Uncertain significance': 'Uncertain significance',
  'Uncertain Significance': 'Uncertain significance',
  'Likely Benign': 'Likely benign',
  'Likely benign': 'Likely benign',
  'LB': 'Likely benign',
  'Benign': 'Benign',
}

export function normalizeAcmgClassification(raw: string): AcmgClassification | null {
  return ACMG_NORMALIZATION[raw] ?? null
}
```

3. Add a database migration to normalize existing rows **and replace live triggers**.

The `acmg_best` column is maintained by AFTER triggers in `migrations.ts` (lines 714, 772, 827, 888, 954, 1017) that hardcode ACMG label strings in SQL CASE expressions. If labels are normalized in data rows without replacing these triggers, old databases will keep recomputing `acmg_best` with stale label strings. The migration must:

```sql
-- Step 1: Normalize stored label values
UPDATE variant_annotations SET acmg_classification = 'Likely pathogenic'
  WHERE acmg_classification IN ('Likely Pathogenic', 'LP');
UPDATE variant_annotations SET acmg_classification = 'Uncertain significance'
  WHERE acmg_classification IN ('VUS', 'Uncertain Significance');
UPDATE variant_annotations SET acmg_classification = 'Likely benign'
  WHERE acmg_classification IN ('Likely Benign', 'LB');
-- Repeat for case_variant_annotations table

-- Step 2: DROP and recreate all AFTER triggers on variant_annotations
--   and case_variant_annotations that reference ACMG labels.
--   Use canonical labels in the new trigger definitions.

-- Step 3: Recompute acmg_best for all rows in cohort_variant_summary
--   to fix any stale values left by the old triggers.
```

4. Update IPC schema (`ipc-schemas.ts`) to use the canonical enum.
5. Update summary SQL (`cohort-summary-rebuild.ts`, `cohort.ts`) to match.
6. Update test fixtures that use old label formats.

7. **Update renderer ACMG constants and UI mappings.** The following renderer files hardcode old ACMG labels and must be updated to match the canonical values:
   - `src/renderer/src/composables/useAnnotations.ts:781-807` -- `ACMG_CLASSIFICATION_ORDER` array uses `'Likely Pathogenic'`, `'VUS'`, `'Likely Benign'`; `ACMG_CLASSIFICATION_COLORS` and `ACMG_CLASSIFICATION_SHORT` maps use the same old keys
   - `src/renderer/src/utils/filters/constants.ts:11-28` -- `ACMG_FILTER_OPTIONS` and `ACMG_CLASSIFICATIONS` arrays use `'Likely Pathogenic'`, `'VUS'`, `'Likely Benign'` as `value` fields

   These drive chip labels, filter payloads, color assignments, and comparison logic. If normalized on the backend without updating these, the renderer will send old-format values in filter requests and fail to match database entries. **All renderer ACMG string literals must come from the shared canonical constant in `src/shared/config/domain.config.ts`.**

**Files to modify:**
- `src/shared/config/domain.config.ts` (canonical labels + colors + abbreviations)
- `src/shared/utils/acmg.ts` (new normalizer)
- `src/main/database/types.ts` (update `AcmgClassification` type)
- `src/shared/types/ipc-schemas.ts` (update schema enum values)
- `src/shared/sql/cohort-summary-rebuild.ts` (match canonical labels)
- `src/main/database/cohort.ts` (match canonical labels)
- `src/main/database/migrations.ts` (add migration with trigger replacement + data normalization)
- `src/renderer/src/composables/useAnnotations.ts` (update ACMG_CLASSIFICATION_ORDER, colors, abbreviations)
- `src/renderer/src/utils/filters/constants.ts` (update ACMG_FILTER_OPTIONS, ACMG_CLASSIFICATIONS)
- Test fixtures using old label formats
- Tests for normalizer + migration + trigger behavior

**References:**
- [ACMG/AMP 2015 Guidelines](https://pmc.ncbi.nlm.nih.gov/articles/PMC4544753/) -- Richards et al.
- [ClinVar clinical significance](https://www.ncbi.nlm.nih.gov/clinvar/docs/clinsig/) -- uses sentence case

---

### 1.3 Fix Cohort Boolean Search Parser

**Review finding:** `cohort.ts:107-117` `buildBooleanSearchCondition()` appends `AND NOT` for every NOT token. `A OR NOT B` produces invalid SQL. No operator precedence.

**Important architectural note:** Cohort search and variant search use fundamentally different SQL backends:
- **Cohort search** (`cohort.ts:294`): LIKE-based queries against summary table columns
- **Variant search** (`VariantRepository.ts:664`): FTS5 MATCH with ranking logic

Sharing a single SQL renderer across both would risk regressing variant search. The correct split is:
- **Share:** tokenization and AST construction (parse `A OR NOT B` into a precedence-correct tree)
- **Separate:** backend-specific SQL emitters (LIKE-based for cohort, FTS5 MATCH for variant)

**What to do:**

1. Create a shared tokenizer + AST builder in `src/shared/utils/boolean-search.ts`:
   - Tokenize input into terms and operators (AND/OR/NOT)
   - Parse into a precedence-correct AST: NOT > AND > OR (matches both SQL and FTS5)
   - Support parentheses for explicit grouping
   - Validate: no adjacent operators, no trailing operators, balanced parens

2. Create backend-specific emitters:
   - `src/main/database/search/cohort-search-emitter.ts`: walks the AST, emits LIKE-based SQL with `?` params
   - `src/main/database/search/fts5-search-emitter.ts`: walks the AST, emits FTS5 MATCH expressions with proper term escaping (`"${term.replace(/"/g, '""')}"`)

3. Replace `buildBooleanSearchCondition()` in `cohort.ts` with shared parser + cohort emitter.
4. Refactor search logic in `VariantRepository.ts` to use shared parser + FTS5 emitter (careful not to regress existing FTS5 ranking behavior).

5. Add comprehensive tests:
   - Shared parser tests (AST correctness):
     - `BRCA1` -> single term node
     - `BRCA1 AND TP53` -> AND node
     - `NOT BRCA1` -> NOT node
     - `BRCA1 OR NOT TP53` -> correct precedence
     - `BRCA1 AND TP53 OR EGFR` -> AND binds tighter than OR
     - `(BRCA1 OR TP53) AND NOT EGFR` -> explicit grouping
     - Empty input, operator-only input -> validation errors
   - Cohort emitter tests (LIKE SQL output)
   - FTS5 emitter tests (MATCH expression output)

**Files to modify:**
- `src/shared/utils/boolean-search.ts` (new shared tokenizer + AST)
- `src/main/database/search/cohort-search-emitter.ts` (new LIKE emitter)
- `src/main/database/search/fts5-search-emitter.ts` (new FTS5 emitter)
- `src/main/database/cohort.ts` (use shared parser + cohort emitter)
- `src/main/database/VariantRepository.ts` (use shared parser + FTS5 emitter, preserve ranking)
- Tests for parser, both emitters, and integration

**References:**
- [SQLite FTS5 full-text queries](https://sqlite.org/fts5.html#full_text_query_syntax) -- FTS5 boolean precedence
- Standard recursive descent precedence parsing (same pattern as existing `src/renderer/src/dsl/parser.ts`)

---

### 1.4 Fix `setWindowOpenHandler` URL Validation

**Review finding:** `src/main/index.ts:76-79` passes `details.url` directly to `shell.openExternal()` with no validation, bypassing the HTTPS + domain allowlist enforced in `shell.ts`.

**What to do:**

1. Move the domain allowlist and validation into a neutral main-process utility. The current `ALLOWED_DOMAINS` lives in `src/main/ipc/handlers/shell.ts:26-41`. Having `index.ts` import from an IPC handler inverts the dependency direction. Instead:

```typescript
// src/main/config/allowed-domains.ts  (neutral config, no IPC dependency)
export const ALLOWED_DOMAINS = [
  'github.com', 'github.io', 'opensource.org',
  'gnomad.broadinstitute.org', 'ncbi.nlm.nih.gov',
  // ... full list
] as const

// src/main/utils/url-validation.ts  (neutral utility)
import { ALLOWED_DOMAINS } from '../config/allowed-domains'

let userDomains: string[] = []

export function setUserDomains(domains: string[]): void {
  userDomains = domains.filter(isValidHostname)
}

export function isDomainAllowed(hostname: string): boolean {
  const allDomains = [...ALLOWED_DOMAINS, ...userDomains]
  return allDomains.some(d => hostname === d || hostname.endsWith(`.${d}`))
}

export function isUrlSafeForExternal(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    return isDomainAllowed(parsed.hostname)
  } catch {
    return false
  }
}

function isValidHostname(h: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(h)
}
```

2. Both `src/main/index.ts` (setWindowOpenHandler) and `src/main/ipc/handlers/shell.ts` consume from this shared utility:

```typescript
// src/main/index.ts
import { isUrlSafeForExternal } from './utils/url-validation'

mainWindow.webContents.setWindowOpenHandler(({ url }) => {
  if (isUrlSafeForExternal(url)) {
    setImmediate(() => shell.openExternal(url))
  }
  return { action: 'deny' }
})
```

3. `shell.ts` imports `isDomainAllowed`, `setUserDomains` from the shared utility instead of defining them locally.

**Files to modify:**
- `src/main/config/allowed-domains.ts` (new -- move allowlist here)
- `src/main/utils/url-validation.ts` (new -- validation + hostname checker)
- `src/main/index.ts:76-79` (use `isUrlSafeForExternal`)
- `src/main/ipc/handlers/shell.ts` (import from shared utility, remove local copies)
- Tests for URL validation and hostname validation

**References:**
- [Electron security checklist #14-15](https://www.electronjs.org/docs/latest/tutorial/security)
- [Bishop Fox - Design a Reasonably Secure Electron Framework](https://bishopfox.com/blog/reasonably-secure-electron)

---

### 1.5 Scope Annotation Cache by Case/Database

**Review finding:** `useAnnotations.ts` cache key is `chr:pos:ref:alt` (line 83) without case/database scope. Same variant in different cases can show wrong star/comment/ACMG state.

**Important:** A partial key change without lifecycle wiring will still leave stale entries. The fix must also scope `loadingStates`, batch-result handling, and add automatic invalidation on DB switch.

**What to do:**

1. Scope cache keys by database path + case ID:

```typescript
function makeCacheKey(dbPath: string, caseId: number, variantKey: string): string {
  return `${dbPath}::${caseId}::${variantKey}`
}
```

2. Scope the `loadingStates` Map with the same composite key (currently also keyed only by coordinate).

3. Clear **both** the annotation cache and loadingStates on database switch. Watch the database store's path ref:

```typescript
const dbStore = useDatabaseStore()
watch(() => dbStore.currentPath, () => {
  annotationCache.value.clear()
  loadingStates.clear()
})
```

4. Also clear on case switch (or scope per-case annotations separately from global annotations, since global annotations are shared across cases within the same database).

5. Fix batch-result caching to use composite keys. Currently `loadAnnotationsBatch` (line 242-246) receives coordinate-keyed results from `api.annotations.batchGet` and writes them directly into the cache with `cacheSet(key, value)`. After scoping the cache by case/database, the client must **re-key all returned entries** with the composite scope key before caching:

```typescript
// Before (current -- coordinate-keyed):
for (const [key, value] of Object.entries(results)) {
  cacheSet(key, value as AnnotationCache)
}

// After (composite-keyed):
const currentCaseId = caseId  // capture at call time
for (const [coordKey, value] of Object.entries(results)) {
  // Only cache if we're still on the same case (guard async race)
  if (activeCaseId.value !== currentCaseId) break
  const scopedKey = makeCacheKey(dbPath.value, currentCaseId, coordKey)
  cacheSet(scopedKey, value as AnnotationCache)
}
```

The IPC response shape does NOT need to change -- the server still returns coordinate-keyed results. The client re-keys them with the composite scope before insertion.

**Files to modify:**
- `src/renderer/src/composables/useAnnotations.ts` (cache key scoping, loadingStates scoping, batch-result re-keying, DB switch watcher, case switch cleanup, async race guard)
- Test for same variant with different annotations in two cases
- Test for DB switch clearing stale cache
- Test for fast case switch discarding stale batch response

---

### 1.6 Remaining Security Fixes

| Task | File | What to do |
|------|------|------------|
| Add admin check to `auth:listUsers` | `src/main/ipc/handlers/auth.ts:88` | Add the same `currentUser.role === 'admin'` gate used on adjacent handlers |
| Make `createFirstUser` transactional | `src/main/services/auth/AuthService.ts:50-90` | Wrap recovery_key_hash write + accounts_enabled + admin insert in `db.transaction()` |
| Run `npm audit fix` | `package.json` | Fix @xmldom/xmldom and other dep vulnerabilities |

---

## Phase 2: Test Coverage & CI (Priority: HIGH)

Restore trustworthy quality gates before adding features.

### 2.1 Wire Coverage Into CI and Set Realistic Thresholds

**Review finding (corrected):** The `ENOENT` in `coverage/.tmp/` was reported by two reviewers running in isolated workspaces, but local verification shows `npm run test:coverage` completes successfully (141 files, 1872 tests, coverage generated). The actual failure is the configured 70% threshold in `vitest.config.ts:42` -- the real gap is that **CI still runs plain `npm run test` in `.github/workflows/build.yml:67`**, so coverage thresholds are never enforced.

**What to do:**
1. Change `npm run test` to `npm run test:coverage` in `.github/workflows/build.yml` (at minimum on ubuntu runner)
2. Set realistic per-directory thresholds (see 2.2 below) so the coverage step actually passes
3. Verify locally: `npm run test:coverage` should exit 0 with the new thresholds

---

### 2.2 Set Realistic Per-Directory Coverage Thresholds

**Review finding:** Global 70% threshold fails silently (actual: 31%). Not enforced in CI.

**What to do:**

Replace the global threshold with per-directory thresholds in `vitest.config.ts`:

```typescript
thresholds: {
  // Areas with good coverage -- hold the line
  'src/main/database/**/*.ts': { lines: 70, functions: 70 },
  'src/main/import/vcf/**/*.ts': { lines: 85, functions: 85 },
  'src/main/statistics/**/*.ts': { lines: 75, functions: 70 },
  'src/renderer/src/dsl/**/*.ts': { lines: 80, functions: 85 },
  'src/renderer/src/utils/acmg/**/*.ts': { lines: 95, functions: 95 },

  // Areas with low coverage -- set floor, raise incrementally
  'src/main/ipc/handlers/**/*.ts': { lines: 5, functions: 5 },
  'src/main/workers/**/*.ts': { lines: 5, functions: 5 },
  'src/renderer/src/components/**/*.{ts,vue}': { lines: 10, functions: 5 },
  'src/renderer/src/stores/**/*.ts': { lines: 25, functions: 20 },
}
```

Enable ratcheting to prevent regression:

```typescript
thresholds: {
  autoUpdate: (n: number) => Math.floor(n),
  // ... per-directory thresholds
}
```

**References:**
- [Vitest coverage glob thresholds](https://vitest.dev/config/coverage)
- [Vitest autoUpdate ratcheting](https://vitest.dev/config/coverage#thresholds-autoupdate)

---

### 2.3 Add Coverage to CI Pipeline

**What to do:**

1. Change `npm run test` to `npm run test:coverage` in `.github/workflows/build.yml` (at minimum on ubuntu)
2. Add `json-summary` to coverage reporters in `vitest.config.ts`
3. Add `davelosert/vitest-coverage-report-action@v2` for PR coverage comments
4. Make the release workflow reuse the same quality checks as the build workflow

**References:**
- [vitest-coverage-report-action](https://github.com/davelosert/vitest-coverage-report-action)

---

### 2.4 Convert IPC Handler Tests to Proper Pattern

**Review finding:** Handler tests (e.g., `cases-handlers.test.ts`) test the repository layer directly, not the IPC handler registration. Only `auth-handlers.test.ts` uses the correct pattern.

**What to do:**

Adopt the `auth-handlers.test.ts` pattern across all handler tests. The pattern:

```typescript
const handlers = new Map<string, Function>()
const mockIpcMain = {
  handle: vi.fn((channel: string, handler: Function) => {
    handlers.set(channel, handler)
  }),
}

// Register handlers with DI
registerCaseHandlers({ ipcMain: mockIpcMain, getDb: () => db, ... })

// Test through registered handler
async function invokeHandler(channel: string, ...args: unknown[]) {
  const handler = handlers.get(channel)
  return handler({}, ...args) // {} = fake IpcMainInvokeEvent
}

it('cases:list returns cases', async () => {
  const result = await invokeHandler('cases:list', { search: '' })
  expect(result).toEqual([...])
})
```

**Priority order** (by risk / line count):
1. `variants.ts` (265 lines) -- most used
2. `database.ts` (348 lines) -- high security risk
3. `cases.ts` (247 lines) -- core functionality
4. `cohort.ts` (338 lines) -- complex logic
5. `annotations.ts` (434 lines) -- correctness-sensitive
6. `import.ts` (162 lines) -- missing Zod validation (add as part of test)

**References:**
- [Electron IPC testing without Electron](https://github.com/electron/electron/issues/38560)
- Existing good pattern: `tests/main/handlers/auth-handlers.test.ts`

---

### 2.5 Extract and Test Worker Business Logic

**Review finding:** Worker files have 0% coverage. `import-worker.ts` (815 lines) mixes parsing, DB writes, FTS rebuild, and summary rebuild.

**What to do:**

Extract pure business logic from each worker into importable modules:

```
src/main/workers/import-worker.ts      -> thin messaging shell
src/main/workers/import-logic.ts       -> NEW: parsing + batch insert logic
src/main/workers/delete-logic.ts       -> NEW: deletion steps
src/main/workers/export-logic.ts       -> NEW: export formatting
```

The logic modules take explicit dependencies (db handle, config) and return results.
The worker entry files just wire `parentPort.on('message')` to the logic functions.

Test the logic modules directly with in-memory SQLite:

```typescript
import { processBatch } from '../src/main/workers/import-logic'
import { DatabaseService } from '../src/main/database/DatabaseService'

it('processBatch inserts variants correctly', () => {
  const db = new DatabaseService(':memory:')
  const result = processBatch(db, testVariants, { batchSize: 100 })
  expect(result.inserted).toBe(testVariants.length)
  db.close()
})
```

---

### 2.6 Add Regression Tests for Domain Fixes

After Phase 1 fixes, add focused regression tests:

| Test | Validates |
|------|-----------|
| GT dosage with real VCF strings | `0/1` -> 1, `1/1` -> 2, `./.` -> null |
| ACMG label normalization | `Likely Pathogenic` normalizes to `Likely pathogenic` |
| ACMG summary counts | Summary SQL matches canonical labels |
| Boolean search `A OR NOT B` | Produces valid SQL, correct results |
| Boolean search precedence | `A OR B AND C` -> `A OR (B AND C)` |
| Annotation cache isolation | Same variant in 2 cases shows different annotations |
| `auth:listUsers` unauthorized | Non-admin call rejected |

---

## Phase 3: Type Safety & Architecture (Priority: MEDIUM)

Eliminate the `as any` casts and fix architectural boundaries.

### 3.1 Fix Concrete `as any` Hotspots in WindowAPI

**Review finding:** Stale `WindowAPI` type forces 41+ `as any` casts across 19 files.

**Corrected scope:** There is already a central `WindowAPI` contract in `src/shared/types/api.ts:692` and the preload global declaration in `src/preload/index.d.ts:1` references it. The problem is not "no single source of truth" -- it is that `WindowAPI` is missing some methods that the preload bridge exposes (e.g., `geneSymbols`, `runAssociation`, `cancelAssociation`, `onAssociationProgress`, `geneBurden`), so renderer code bypasses the type surface with `as any`.

**Important:** Not all `as any` casts are caused by missing types. Some are gratuitous casts against methods that already exist. For example, `useCohortData.ts:124-126` casts `api` to `any` to access `cohort.onSummaryRebuilt`, but `onSummaryRebuilt` is already declared in `src/shared/types/api.ts:336`. Split the work into two buckets:

**Bucket A -- Remove gratuitous casts (no type changes needed):**
These files cast to `any` for methods that already exist in `WindowAPI`:
- `useCohortData.ts:124,261,294` -- `cohort.onSummaryRebuilt`, `cohort.getVariants`, `cohort.getSummary` all exist at api.ts:327-336
- Any others found during audit where the method already exists in the type

**Bucket B -- Add missing methods to WindowAPI:**
These files cast to `any` because the method genuinely isn't in the type:
- `GeneBurdenView.vue` -- `cohort.runAssociation`, `cohort.cancelAssociation`, `cohort.onAssociationProgress`, `cohort.geneBurden`, `caseMetadata.listCohorts`
- Others found during preload audit

**What to do:**

1. **Audit:** Diff `src/preload/index.ts` methods against `src/shared/types/api.ts` sub-interfaces. Categorize each `as any` cast as Bucket A or B.
2. **Bucket A first** (zero risk): Remove casts and `eslint-disable` comments where methods already exist. This is a pure cleanup PR.
3. **Bucket B:** Add missing methods to `WindowAPI` sub-interfaces, then remove casts. This requires verifying return types match the actual IPC handlers.

**Optional later cleanup (not in this phase):** A full IPC channel map + typed invoke/on helpers could replace the manual `WindowAPI` maintenance entirely. This is architecturally cleaner but involves rewriting 120+ channel definitions and all preload wiring. Evaluate after the concrete hotspots are fixed -- if `WindowAPI` stays in sync going forward, the channel map may not be worth the churn.

**References:**
- [@electron-toolkit/typed-ipc](https://www.npmjs.com/package/@electron-toolkit/typed-ipc) -- for future consideration
- [Electron typed IPC discussion #33691](https://github.com/electron/electron/issues/33691)

---

### 3.2 Consolidate FilterState Types

**Review finding:** 3 separate FilterState definitions (`shared/types/filters.ts`, `composables/filter-types.ts`, `composables/useFilters.ts`) with divergent fields.

**What to do:**

1. Define one canonical type in `src/shared/types/filters.ts`, **preserving existing wire semantics**:

```typescript
export interface FilterStateBase {
  searchQuery: string
  geneSymbol: string
  consequences: string[]
  // ... shared fields
}

export interface CaseFilterState extends FilterStateBase {
  tagIds: number[]
  annotationScope: 'case' | 'all'  // matches existing IPC contract (ipc-schemas.ts:239, types.ts:167)
}

export interface CohortFilterState extends FilterStateBase {
  minCarriers: number
}

export type FilterState = CaseFilterState | CohortFilterState
```

**Important:** The `annotationScope` values must be `'case' | 'all'` -- not `'per_case' | 'global'` -- because that is the existing wire format in `src/shared/types/ipc-schemas.ts:239` (`z.enum(['case', 'all'])`), `src/main/database/types.ts:167`, and `src/renderer/src/composables/filter-types.ts:19`. Changing these values would require an IPC/API migration. This task is a consolidation, not a semantic rewrite.

2. Delete `composables/filter-types.ts` and update imports (keep only composable-specific return type interfaces like `UseFilterStateReturn` if needed, moving them into the composable file itself).
3. Update `useFilters.ts` to import from shared.
4. Resolve the existing TODO at `filters.ts:14`.

---

### 3.3 Extract `safeEmit` to Shared Utility

**Review finding:** Identical function copied in 4 IPC handler files.

**What to do:**

Create `src/main/ipc/utils/safeEmit.ts`:

```typescript
import { BrowserWindow } from 'electron'

export function safeEmit(channel: string, data: unknown): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win === undefined || win.isDestroyed()) return
  win.webContents.send(channel, data)
}
```

Replace the 4 copies in `cases.ts`, `cohort.ts`, `import.ts`, `batch-import.ts`.

---

### 3.4 Re-Export Shared Types (Remove Renderer -> Main Imports)

**Review finding:** 20+ renderer files import types directly from `src/main/`.

**What to do:**

1. Identify all cross-boundary type imports:
   - `AcmgClassification` from `main/database/types`
   - `VepTranscriptConsequence` from `main/services/api/schemas/vep-response`
   - `VcfPreviewResult` from `main/import/vcf/types`
   - `Tag`, `GeneList` from `main/database/types`

2. Re-export each through `src/shared/types/`:
   - `src/shared/types/annotations.ts` -- ACMG types
   - `src/shared/types/api.ts` -- VEP types
   - `src/shared/types/import-worker.ts` -- VCF types

3. Update all renderer imports to use `src/shared/types/`.

---

### 3.5 Refactor GeneBurdenView.vue

**Review finding:** 10+ raw `(window as any).api` calls, no `useApiService()`, 12 eslint-disable comments.

**What to do:**

1. Create `src/renderer/src/composables/useAssociation.ts` to encapsulate association API calls
2. Use `useApiService()` for typed API access
3. Define proper TypeScript interfaces for association config and results
4. Remove all `eslint-disable` comments
5. Add `isAvailable` guard for browser dev mode compatibility

---

## Phase 4: Maintainability (Priority: NORMAL)

Reduce complexity and improve developer experience.

### 4.1 Audit Empty `catch {}` Blocks

**Review finding:** 60+ empty catches, 15 in import-worker alone.

**What to do:**

Categorize each catch block:

| Context | Action |
|---------|--------|
| Worker threads (no mainLogger) | Add `console.warn('context: ' + error)` |
| Renderer components | Show snackbar via `useAppState().showSnackbar()` |
| Main process | Use `mainLogger.warn(msg, 'source')` |
| Genuine best-effort (e.g., cleanup on exit) | Add comment explaining why silence is intentional |

Priority: Start with `import-worker.ts` (15 catches) -- silent import failures are the highest risk.

---

### 4.2 Decompose `useFilterState` (701 lines)

**Review finding:** Combines filter state, presets, gene autocomplete, debounced emission, LRU caching, case-switch reset, and filter options loading.

**What to do:**

Split into focused composables using the facade pattern:

```
useFilterState.ts        -> thin facade (~80 lines), delegates to:
  useFilterCriteria.ts   -> filter field state + defaults + clearing
  useFilterPresets.ts    -> preset save/load/sync/divergence
  useFilterGene.ts       -> gene symbol autocomplete
  useFilterOptions.ts    -> filter option loading + LRU cache
  useFilterLifecycle.ts  -> case-switch reset, initial search setup
```

Replace `JSON.stringify` deep watchers with granular getter-array watchers:

```typescript
watch(
  [() => filters.searchQuery, () => filters.geneSymbol, () => filters.consequences.length],
  () => emitFilters(),
)
```

**References:**
- [Michael Thiessen - Composable Design Patterns](https://michaelnthiessen.com/composable-patterns-in-vue)
- [Vue.js Composables Guide](https://vuejs.org/guide/reusability/composables.html)

---

### 4.3 Make Router Single Source of Truth

**Review finding:** `useAppState` mixes selection state with navigation state. `App.vue` watches `activeTab` to drive routing while handlers also call `router.push` directly -- two sources of truth.

**What to do:**

1. Make URL the authoritative state for active tab, selected case, selected variant
2. Use `@vueuse/router` `useRouteQuery` for URL-synced refs where applicable
3. Use `beforeEach` route guards for side effects (case loading) instead of watchers
4. Remove navigation-related refs from `useAppState`

---

### 4.4 Decompose `VariantRepository.ts` (1094 lines)

**What to do:**

Split into focused modules:

```
VariantRepository.ts           -> query + CRUD (~400 lines)
VariantFilterBuilder.ts        -> filter WHERE clause construction
VariantSearchService.ts        -> FTS5 search + boolean parsing
VariantFrequencyService.ts     -> internal_af computation
VariantFilterOptionsService.ts -> filter option retrieval
```

---

### 4.5 Split `import-worker.ts` (815 lines)

Already addressed in Phase 2.5 (extract logic for testing). The remaining task is to ensure the modules are well-named and documented.

---

### 4.6 Create Shared `LruMap<K,V>` Utility

**Review finding:** Same LRU eviction pattern in 3+ composables.

**What to do:**

Option A (preferred): Add `lru-cache` npm package (v11, TypeScript-native, zero deps, 40M+ weekly downloads):

```typescript
import { LRUCache } from 'lru-cache'
const cache = new LRUCache<string, AnnotationData>({ max: 5000 })
```

Option B (if zero-dep requirement): Create `src/renderer/src/utils/lru-map.ts` with the extracted Map-based pattern. Replace the 3+ inline implementations.

**References:**
- [lru-cache npm](https://www.npmjs.com/package/lru-cache)

---

### 4.7 Add Streaming Insert for Large VCF Support

**Review finding:** `import-worker.ts` loads entire parsed file into memory before batch insertion. Works for clinical VCFs but fails for whole-genome (millions of variants).

**What to do:**

Implement a streaming insert using async generators:

```typescript
async function* parseVcfStream(filePath: string, header: VcfHeader): AsyncGenerator<ParsedVariant[]> {
  // Yield batches of BATCH_INSERT_SIZE variants
  let batch: ParsedVariant[] = []
  for await (const line of createLineReader(filePath)) {
    batch.push(parseLine(line, header))
    if (batch.length >= BATCH_INSERT_SIZE) {
      yield batch
      batch = []
    }
  }
  if (batch.length > 0) yield batch
}

// In worker:
for await (const batch of parseVcfStream(filePath, header)) {
  insertBatch(db, batch)
  reportProgress(inserted += batch.length)
}
```

This keeps memory usage constant regardless of file size.

---

## Phase Summary

| Phase | Tasks | Priority | Timeline | Target Rating Impact |
|-------|-------|----------|----------|---------------------|
| 1: Correctness & Security | 9 tasks | CRITICAL | Week 1-2 | Domain: 5 -> 8, Security: 7 -> 8.5 |
| 2: Test Coverage & CI | 6 tasks | HIGH | Weeks 2-4 | Coverage: 4 -> 6.5, CI: 5.5 -> 7.5 |
| 3: Type Safety & Architecture | 5 tasks | MEDIUM | Weeks 4-6 | Architecture: 7 -> 8.5, Quality: 6.5 -> 8 |
| 4: Maintainability | 7 tasks | NORMAL | Weeks 6-8 | Maintainability: 7 -> 8.5 |

**Projected overall rating after all phases: 6.5 -> 8.0+**

---

## Dependencies Between Tasks

```
Phase 1.1 (genotype) -----> Phase 2.6 (regression tests)
Phase 1.2 (ACMG) ---------> Phase 2.6 (regression tests)
Phase 1.3 (boolean search) -> Phase 2.6 (regression tests)
Phase 2.1 (CI coverage) + Phase 2.2 (thresholds) --> Phase 2.3 (coverage action)
Phase 2.5 (extract worker logic) --> Phase 4.5 (split import-worker)
Phase 3.1 (fix WindowAPI) --> Phase 3.5 (refactor GeneBurdenView)
Phase 3.2 (FilterState) --> Phase 4.2 (decompose useFilterState)
Phase 4.6 (LRU utility) --> Phase 4.2 (use in decomposed composables)
```

Tasks within each phase that have no dependencies can be done in parallel.
