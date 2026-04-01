# PR 1: Correctness & Security — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Fix 6 correctness bugs and security gaps identified by cross-AI code review — genotype dosage, ACMG label inconsistency, boolean search parser, URL validation, annotation cache scoping, and auth/transaction fixes.

**Architecture:** Each task is self-contained with its own tests. All 6 tasks are independent and can execute in parallel. Branch `fix/correctness-security` off `main`, one atomic commit per task. Merge as single PR.

**Tech Stack:** TypeScript, better-sqlite3-multiple-ciphers, Vue 3 composables, Vitest, Zod

**Spec:** [.planning/specs/2026-04-01-stability-hardening-design.md](../specs/2026-04-01-stability-hardening-design.md)

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `src/shared/sql/genotype-dosage.ts` | Canonical GT-to-dosage SQL CASE expression |
| `src/shared/utils/genotype.ts` | TS utility for GT-to-dosage conversion |
| `src/shared/utils/acmg.ts` | ACMG label normalization function |
| `src/shared/utils/boolean-search.ts` | Tokenizer + AST builder for boolean search |
| `src/main/database/search/cohort-search-emitter.ts` | LIKE-based SQL emitter for cohort search |
| `src/main/database/search/fts5-search-emitter.ts` | FTS5 MATCH emitter for variant search |
| `src/shared/config/allowed-domains.ts` | Domain allowlist (extracted from shell.ts) |
| `src/main/utils/url-validation.ts` | URL + hostname validation utility |
| `tests/shared/utils/genotype.test.ts` | Genotype dosage tests |
| `tests/shared/sql/genotype-dosage.test.ts` | SQL CASE cross-check tests |
| `tests/shared/utils/acmg.test.ts` | ACMG normalization tests |
| `tests/shared/utils/boolean-search.test.ts` | Boolean search parser tests |
| `tests/main/database/search/cohort-search-emitter.test.ts` | Cohort emitter tests |
| `tests/main/database/search/fts5-search-emitter.test.ts` | FTS5 emitter tests |
| `tests/main/utils/url-validation.test.ts` | URL validation tests |

### Modified Files
| File | What Changes |
|------|-------------|
| `src/main/database/AssociationDataBuilder.ts` | Replace `CAST(COALESCE(gt_num, '0') AS INTEGER)` with `GT_DOSAGE_SQL` |
| `src/shared/config/domain.config.ts` | Add ACMG canonical labels, colors, abbreviations |
| `src/shared/types/ipc-schemas.ts` | Update ACMG enum to canonical sentence-case values |
| `src/main/database/types.ts` | Update `AcmgClassification` type to canonical values |
| `src/main/database/cohort.ts` | Fix ACMG switch statement + replace `buildBooleanSearchCondition` |
| `src/main/database/migrations.ts` | Add migration to normalize stored ACMG labels |
| `src/renderer/src/composables/useAnnotations.ts` | Update ACMG constants + scope cache by case/db |
| `src/renderer/src/utils/filters/constants.ts` | Update ACMG filter options to canonical values |
| `src/renderer/src/utils/acmg/acmg-calculator.ts` | Update return values to canonical forms |
| `src/main/database/VariantRepository.ts` | Replace inline boolean parsing with shared parser + FTS5 emitter |
| `src/main/index.ts` | Route `setWindowOpenHandler` through URL validation |
| `src/main/ipc/handlers/shell.ts` | Import from shared URL validation utility |
| `src/main/ipc/handlers/auth.ts` | Add admin check to `auth:listUsers` |
| `src/main/services/auth/AuthService.ts` | Wrap `createFirstUser` in transaction |
| `package.json` | Targeted dep updates for @xmldom/xmldom |

---

## Task 1: Fix Genotype Dosage Derivation

**Files:**
- Create: `src/shared/sql/genotype-dosage.ts`
- Create: `src/shared/utils/genotype.ts`
- Create: `tests/shared/utils/genotype.test.ts`
- Create: `tests/shared/sql/genotype-dosage.test.ts`
- Modify: `src/main/database/AssociationDataBuilder.ts:59`

- [x] **Step 1: Write failing tests for TS utility**

Create `tests/shared/utils/genotype.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { gtToDosage } from '../../../src/shared/utils/genotype'

describe('gtToDosage', () => {
  it('returns 0 for homozygous reference 0/0', () => {
    expect(gtToDosage('0/0')).toBe(0)
  })

  it('returns 0 for phased homozygous reference 0|0', () => {
    expect(gtToDosage('0|0')).toBe(0)
  })

  it('returns 1 for heterozygous 0/1', () => {
    expect(gtToDosage('0/1')).toBe(1)
  })

  it('returns 1 for reversed heterozygous 1/0', () => {
    expect(gtToDosage('1/0')).toBe(1)
  })

  it('returns 1 for phased heterozygous 0|1', () => {
    expect(gtToDosage('0|1')).toBe(1)
  })

  it('returns 1 for phased reversed heterozygous 1|0', () => {
    expect(gtToDosage('1|0')).toBe(1)
  })

  it('returns 2 for homozygous alt 1/1', () => {
    expect(gtToDosage('1/1')).toBe(2)
  })

  it('returns 2 for phased homozygous alt 1|1', () => {
    expect(gtToDosage('1|1')).toBe(2)
  })

  it('returns null for missing ./.', () => {
    expect(gtToDosage('./.')).toBeNull()
  })

  it('returns null for phased missing .|.', () => {
    expect(gtToDosage('.|.')).toBeNull()
  })

  it('returns null for single missing .', () => {
    expect(gtToDosage('.')).toBeNull()
  })

  it('returns 1 for haploid alt 1', () => {
    expect(gtToDosage('1')).toBe(1)
  })

  it('returns 0 for haploid ref 0', () => {
    expect(gtToDosage('0')).toBe(0)
  })

  it('returns null for null input', () => {
    expect(gtToDosage(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(gtToDosage(undefined)).toBeNull()
  })

  it('handles multi-allelic 0/2 via fallback', () => {
    expect(gtToDosage('0/2')).toBe(1)
  })

  it('handles multi-allelic 2/2 via fallback', () => {
    expect(gtToDosage('2/2')).toBe(2)
  })

  it('handles partial missing 0/. as null', () => {
    expect(gtToDosage('0/.')).toBeNull()
  })
})
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shared/utils/genotype.test.ts`
Expected: FAIL — module `src/shared/utils/genotype` does not exist

- [x] **Step 3: Implement TS utility**

Create `src/shared/utils/genotype.ts`:

```typescript
/**
 * Convert a VCF GT string to allele dosage (count of non-reference alleles).
 *
 * Standard mapping per VCF v4.3 spec + PLINK/Hail conventions:
 * - 0/0, 0|0 → 0 (homozygous reference)
 * - 0/1, 1/0, 0|1, 1|0 → 1 (heterozygous)
 * - 1/1, 1|1 → 2 (homozygous alt)
 * - ./., .|., . → null (missing)
 * - Haploid: 0 → 0, 1 → 1
 * - Multi-allelic: counts non-zero alleles (e.g., 0/2 → 1, 2/2 → 2)
 */
export function gtToDosage(gt: string | null | undefined): number | null {
  if (gt == null) return null
  switch (gt) {
    case '0/0':
    case '0|0':
      return 0
    case '0/1':
    case '1/0':
    case '0|1':
    case '1|0':
      return 1
    case '1/1':
    case '1|1':
      return 2
    case '0':
      return 0
    case '1':
      return 1
    case './.':
    case '.|.':
    case '.':
      return null
    default: {
      const alleles = gt.split(/[/|]/)
      if (alleles.some((a) => a === '.')) return null
      return alleles.filter((a) => a !== '0').length
    }
  }
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/shared/utils/genotype.test.ts`
Expected: All 19 tests PASS

- [x] **Step 5: Create SQL CASE constant**

Create `src/shared/sql/genotype-dosage.ts`:

```typescript
/**
 * Canonical GT-to-dosage SQL CASE expression.
 *
 * Maps VCF genotype strings to integer dosage values.
 * Standard mapping per VCF v4.3 spec + PLINK/Hail conventions.
 *
 * Usage: embed in SQL queries as a column expression, e.g.:
 *   `SELECT gene_symbol, ${GT_DOSAGE_SQL} AS dosage FROM variants`
 *
 * The expression references the `gt_num` column from the variants table.
 */
export const GT_DOSAGE_SQL = `CASE gt_num
    WHEN '1/1' THEN 2  WHEN '1|1' THEN 2
    WHEN '0/1' THEN 1  WHEN '1/0' THEN 1
    WHEN '0|1' THEN 1  WHEN '1|0' THEN 1
    WHEN '0/0' THEN 0  WHEN '0|0' THEN 0
    WHEN '1'   THEN 1
    WHEN '0'   THEN 0
    ELSE NULL
  END`
```

- [x] **Step 6: Write cross-check test (SQL CASE vs TS utility)**

Create `tests/shared/sql/genotype-dosage.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { GT_DOSAGE_SQL } from '../../../src/shared/sql/genotype-dosage'
import { gtToDosage } from '../../../src/shared/utils/genotype'

describe('GT_DOSAGE_SQL cross-check with gtToDosage', () => {
  let db: InstanceType<typeof Database>

  beforeAll(() => {
    db = new Database(':memory:')
    db.exec('CREATE TABLE test_gt (gt_num TEXT)')
  })

  afterAll(() => {
    db.close()
  })

  const testCases: Array<[string | null, number | null]> = [
    ['0/0', 0],
    ['0|0', 0],
    ['0/1', 1],
    ['1/0', 1],
    ['0|1', 1],
    ['1|0', 1],
    ['1/1', 2],
    ['1|1', 2],
    ['0', 0],
    ['1', 1],
    ['./.', null],
    ['.|.', null],
    ['.', null],
    [null, null],
  ]

  for (const [gt, expected] of testCases) {
    it(`GT "${gt}" produces dosage ${expected} in both SQL and TS`, () => {
      // TS utility
      const tsResult = gtToDosage(gt)
      expect(tsResult).toBe(expected)

      // SQL CASE
      db.exec('DELETE FROM test_gt')
      db.prepare('INSERT INTO test_gt (gt_num) VALUES (?)').run(gt)
      const row = db.prepare(`SELECT ${GT_DOSAGE_SQL} AS dosage FROM test_gt`).get() as {
        dosage: number | null
      }
      expect(row.dosage).toBe(expected)
    })
  }
})
```

- [x] **Step 7: Run cross-check tests**

Run: `npx vitest run tests/shared/sql/genotype-dosage.test.ts`
Expected: All 14 tests PASS

- [x] **Step 8: Update AssociationDataBuilder to use GT_DOSAGE_SQL**

Modify `src/main/database/AssociationDataBuilder.ts`. Replace the dosage line in the SQL query:

Old (line 59):
```typescript
             CAST(COALESCE(gt_num, '0') AS INTEGER) AS dosage,
```

New:
```typescript
             ${GT_DOSAGE_SQL} AS dosage,
```

Add the import at the top of the file:
```typescript
import { GT_DOSAGE_SQL } from '../../shared/sql/genotype-dosage'
```

- [x] **Step 9: Run existing tests to verify no regressions**

Run: `npx vitest run tests/main/database/`
Expected: All existing database tests PASS

- [x] **Step 10: Commit**

```bash
git add src/shared/sql/genotype-dosage.ts src/shared/utils/genotype.ts \
  src/main/database/AssociationDataBuilder.ts \
  tests/shared/utils/genotype.test.ts tests/shared/sql/genotype-dosage.test.ts
git commit -m "fix: correct genotype dosage derivation for VCF GT strings

CAST(gt_num AS INTEGER) truncated '0/1' to 0, making heterozygous calls
appear as homozygous reference. Replace with shared SQL CASE expression
and TS utility encoding VCF v4.3 standard GT-to-dosage mapping.

Adds cross-check test verifying SQL and TS produce identical results."
```

---

## Task 2: Canonicalize ACMG Classification Labels

**Files:**
- Create: `src/shared/utils/acmg.ts`
- Create: `tests/shared/utils/acmg.test.ts`
- Modify: `src/shared/config/domain.config.ts`
- Modify: `src/shared/types/ipc-schemas.ts:383-386`
- Modify: `src/main/database/types.ts:208-213`
- Modify: `src/main/database/cohort.ts:414-432`
- Modify: `src/main/database/migrations.ts` (add migration)
- Modify: `src/renderer/src/composables/useAnnotations.ts:781-807`
- Modify: `src/renderer/src/utils/filters/constants.ts:11-29`
- Modify: `src/renderer/src/utils/acmg/acmg-calculator.ts:92-138`

**Important context:** The SQL triggers in `migrations.ts` and `cohort-summary-rebuild.ts` already use sentence case (`Likely pathogenic`, `Uncertain significance`, `Likely benign`). The mismatch is that TypeScript types, IPC schemas, and renderer code use title case (`Likely Pathogenic`, `VUS`, `Likely Benign`). We standardize everything to sentence case per ClinVar convention.

**Not in scope:** `filterGroups.ts` values like `Likely_pathogenic` are ClinVar database significance values (underscore format), not ACMG classification labels. The protein visualization files use `ClinVarSignificance` types. Neither should change.

- [x] **Step 1: Write failing tests for normalization function**

Create `tests/shared/utils/acmg.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { normalizeAcmgClassification } from '../../../src/shared/utils/acmg'

describe('normalizeAcmgClassification', () => {
  // Canonical values pass through unchanged
  it('passes through Pathogenic', () => {
    expect(normalizeAcmgClassification('Pathogenic')).toBe('Pathogenic')
  })

  it('passes through Likely pathogenic', () => {
    expect(normalizeAcmgClassification('Likely pathogenic')).toBe('Likely pathogenic')
  })

  it('passes through Uncertain significance', () => {
    expect(normalizeAcmgClassification('Uncertain significance')).toBe('Uncertain significance')
  })

  it('passes through Likely benign', () => {
    expect(normalizeAcmgClassification('Likely benign')).toBe('Likely benign')
  })

  it('passes through Benign', () => {
    expect(normalizeAcmgClassification('Benign')).toBe('Benign')
  })

  // Title case variants normalize to canonical
  it('normalizes Likely Pathogenic to Likely pathogenic', () => {
    expect(normalizeAcmgClassification('Likely Pathogenic')).toBe('Likely pathogenic')
  })

  it('normalizes Uncertain Significance to Uncertain significance', () => {
    expect(normalizeAcmgClassification('Uncertain Significance')).toBe('Uncertain significance')
  })

  it('normalizes Likely Benign to Likely benign', () => {
    expect(normalizeAcmgClassification('Likely Benign')).toBe('Likely benign')
  })

  // Abbreviations normalize
  it('normalizes LP to Likely pathogenic', () => {
    expect(normalizeAcmgClassification('LP')).toBe('Likely pathogenic')
  })

  it('normalizes VUS to Uncertain significance', () => {
    expect(normalizeAcmgClassification('VUS')).toBe('Uncertain significance')
  })

  it('normalizes LB to Likely benign', () => {
    expect(normalizeAcmgClassification('LB')).toBe('Likely benign')
  })

  it('normalizes P to Pathogenic', () => {
    expect(normalizeAcmgClassification('P')).toBe('Pathogenic')
  })

  it('normalizes B to Benign', () => {
    expect(normalizeAcmgClassification('B')).toBe('Benign')
  })

  // Unknown values return null
  it('returns null for unknown value', () => {
    expect(normalizeAcmgClassification('garbage')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(normalizeAcmgClassification('')).toBeNull()
  })
})
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shared/utils/acmg.test.ts`
Expected: FAIL — module `src/shared/utils/acmg` does not exist

- [x] **Step 3: Add canonical ACMG constants to domain config**

Modify `src/shared/config/domain.config.ts` — replace the entire file:

```typescript
/**
 * Canonical ACMG/AMP 2015 classification labels.
 * Follows ClinVar convention: sentence case for multi-word labels.
 *
 * References:
 * - ACMG/AMP 2015: Richards et al. (PMC4544753)
 * - ClinVar clinical significance: https://www.ncbi.nlm.nih.gov/clinvar/docs/clinsig/
 */
export const ACMG_CLASSIFICATIONS = [
  'Pathogenic',
  'Likely pathogenic',
  'Uncertain significance',
  'Likely benign',
  'Benign',
] as const

export type AcmgClassification = (typeof ACMG_CLASSIFICATIONS)[number]

/** Colorblind-safe palette (Okabe-Ito derived) for ACMG classifications. */
export const ACMG_COLORS: Record<AcmgClassification, string> = {
  Pathogenic: '#C62828',
  'Likely pathogenic': '#D55E00',
  'Uncertain significance': '#757575',
  'Likely benign': '#0072B2',
  Benign: '#009E73',
}

/** Short abbreviations for compact display. */
export const ACMG_ABBREV: Record<AcmgClassification, string> = {
  Pathogenic: 'P',
  'Likely pathogenic': 'LP',
  'Uncertain significance': 'VUS',
  'Likely benign': 'LB',
  Benign: 'B',
}

export const DOMAIN_CONFIG = {
  MAX_CADD_SCORE: 60,
} as const
```

- [x] **Step 4: Create the normalization function**

Create `src/shared/utils/acmg.ts`:

```typescript
import type { AcmgClassification } from '../config/domain.config'

/**
 * Map of known ACMG label variants to canonical form.
 * Covers: canonical values, title-case variants, and common abbreviations.
 */
const ACMG_NORMALIZATION: Record<string, AcmgClassification> = {
  // Canonical (pass-through)
  'Pathogenic': 'Pathogenic',
  'Likely pathogenic': 'Likely pathogenic',
  'Uncertain significance': 'Uncertain significance',
  'Likely benign': 'Likely benign',
  'Benign': 'Benign',
  // Title-case variants (old format)
  'Likely Pathogenic': 'Likely pathogenic',
  'Uncertain Significance': 'Uncertain significance',
  'Likely Benign': 'Likely benign',
  // Abbreviations
  'P': 'Pathogenic',
  'LP': 'Likely pathogenic',
  'VUS': 'Uncertain significance',
  'LB': 'Likely benign',
  'B': 'Benign',
}

/**
 * Normalize an ACMG classification string to canonical form.
 * Returns null if the input is not a recognized ACMG value.
 */
export function normalizeAcmgClassification(raw: string): AcmgClassification | null {
  return ACMG_NORMALIZATION[raw] ?? null
}
```

- [x] **Step 5: Run normalization tests**

Run: `npx vitest run tests/shared/utils/acmg.test.ts`
Expected: All 15 tests PASS

- [x] **Step 6: Update TypeScript type in types.ts**

Modify `src/main/database/types.ts:208-213`. Replace the `AcmgClassification` type:

Old:
```typescript
export type AcmgClassification =
  | 'Pathogenic'
  | 'Likely Pathogenic'
  | 'VUS'
  | 'Likely Benign'
  | 'Benign'
```

New:
```typescript
export type { AcmgClassification } from '../../shared/config/domain.config'
```

- [x] **Step 7: Update IPC schema enum**

Modify `src/shared/types/ipc-schemas.ts:383-386`. Replace:

Old:
```typescript
const AcmgClassificationSchema = z
  .enum(['Pathogenic', 'Likely Pathogenic', 'VUS', 'Likely Benign', 'Benign'])
  .nullish()
  .transform((val) => val ?? undefined)
```

New:
```typescript
import { ACMG_CLASSIFICATIONS } from '../config/domain.config'
import { normalizeAcmgClassification } from '../utils/acmg'

const AcmgClassificationSchema = z
  .enum([...ACMG_CLASSIFICATIONS, 'Likely Pathogenic', 'VUS', 'Likely Benign', 'LP', 'LB', 'P', 'B'] as const)
  .nullish()
  .transform((val) => {
    if (val == null) return undefined
    return normalizeAcmgClassification(val) ?? undefined
  })
```

Note: The enum includes old-format values for backward compatibility with existing databases, then the `.transform()` normalizes them to canonical form. This prevents breaking imports of existing data.

- [x] **Step 8: Update ACMG switch in cohort.ts**

Modify `src/main/database/cohort.ts:414-432`. Replace the switch statement:

Old:
```typescript
      switch (row.acmg_classification) {
        case 'Pathogenic':
          acmgCounts.pathogenic = row.count
          break
        case 'Likely Pathogenic':
          acmgCounts.likely_pathogenic = row.count
          break
        case 'VUS':
          acmgCounts.vus = row.count
          break
        case 'Likely Benign':
          acmgCounts.likely_benign = row.count
          break
        case 'Benign':
          acmgCounts.benign = row.count
          break
      }
```

New:
```typescript
      switch (row.acmg_classification) {
        case 'Pathogenic':
          acmgCounts.pathogenic = row.count
          break
        case 'Likely pathogenic':
          acmgCounts.likely_pathogenic = row.count
          break
        case 'Uncertain significance':
          acmgCounts.vus = row.count
          break
        case 'Likely benign':
          acmgCounts.likely_benign = row.count
          break
        case 'Benign':
          acmgCounts.benign = row.count
          break
      }
```

- [x] **Step 9: Update ACMG calculator return values**

Modify `src/renderer/src/utils/acmg/acmg-calculator.ts`. Add import and update all return values:

Add import at top:
```typescript
import type { AcmgClassification } from '../../../../shared/config/domain.config'
```

Update the return type of `classifyByRules` (line 92-94):
```typescript
export function classifyByRules(
  pathogenic: AcmgEvidenceCode[],
  benign: AcmgEvidenceCode[]
): AcmgClassification {
```

Replace all return value strings:
- `'Likely Pathogenic'` -> `'Likely pathogenic'` (8 occurrences, lines 123-132)
- `'Likely Benign'` -> `'Likely benign'` (2 occurrences, lines 135-136)
- `'VUS'` -> `'Uncertain significance'` (1 occurrence, line 138)
- `'Pathogenic'` and `'Benign'` stay unchanged

- [x] **Step 10: Update renderer ACMG constants in useAnnotations.ts**

Modify `src/renderer/src/composables/useAnnotations.ts:781-807`. Replace:

Old:
```typescript
export const ACMG_CLASSIFICATIONS: AcmgClassification[] = [
  'Pathogenic',
  'Likely Pathogenic',
  'VUS',
  'Likely Benign',
  'Benign'
]

export const ACMG_COLORS: Record<AcmgClassification, string> = {
  Pathogenic: '#C62828',
  'Likely Pathogenic': '#D55E00',
  VUS: '#757575',
  'Likely Benign': '#0072B2',
  Benign: '#009E73'
}

export const ACMG_ABBREV: Record<AcmgClassification, string> = {
  Pathogenic: 'P',
  'Likely Pathogenic': 'LP',
  VUS: 'VUS',
  'Likely Benign': 'LB',
  Benign: 'B'
}
```

New:
```typescript
export {
  ACMG_CLASSIFICATIONS,
  ACMG_COLORS,
  ACMG_ABBREV,
} from '../../../../shared/config/domain.config'
```

Also update the `AcmgClassification` import at the top of the file to come from `domain.config` instead of `main/database/types`.

- [x] **Step 11: Update filter constants**

Modify `src/renderer/src/utils/filters/constants.ts`. Replace the entire file:

```typescript
/**
 * Shared filter constants
 *
 * Extracted from FilterToolbar.vue and CohortFilterBar.vue to avoid duplication.
 * ACMG values use canonical sentence-case labels from domain.config.
 */
import { ACMG_CLASSIFICATIONS, ACMG_ABBREV } from '../../../../shared/config/domain.config'

/**
 * ACMG classification filter options (short labels for chips)
 */
export const ACMG_FILTER_OPTIONS = [
  { value: 'Pathogenic', label: 'P', color: 'error' },
  { value: 'Likely pathogenic', label: 'LP', color: 'deep-orange' },
  { value: 'Uncertain significance', label: 'VUS', color: 'warning' },
  { value: 'Likely benign', label: 'LB', color: 'blue-grey' },
  { value: 'Benign', label: 'B', color: 'success' },
] as const

/**
 * ACMG classification filter options with full labels
 */
export const ACMG_FILTER_OPTIONS_LONG = [
  { value: 'Pathogenic', label: 'Pathogenic', color: 'error' },
  { value: 'Likely pathogenic', label: 'Likely pathogenic', color: 'deep-orange' },
  { value: 'Uncertain significance', label: 'Uncertain significance', color: 'warning' },
  { value: 'Likely benign', label: 'Likely benign', color: 'blue-grey' },
  { value: 'Benign', label: 'Benign', color: 'success' },
] as const

export { ACMG_CLASSIFICATIONS, ACMG_ABBREV }
```

- [x] **Step 12: Add database migration**

Modify `src/main/database/migrations.ts`. Add a new migration at the end of the migrations array. Find the last migration number and increment it. The migration normalizes stored ACMG label values in `variant_annotations` and `case_variant_annotations` tables:

```typescript
{
  version: NEXT_VERSION,
  name: 'Normalize ACMG classification labels to ClinVar sentence case',
  up: (db: DatabaseType) => {
    // Step 1: Normalize variant_annotations
    db.exec(`
      UPDATE variant_annotations SET acmg_classification = 'Likely pathogenic'
        WHERE acmg_classification IN ('Likely Pathogenic', 'LP');
      UPDATE variant_annotations SET acmg_classification = 'Uncertain significance'
        WHERE acmg_classification IN ('VUS', 'Uncertain Significance');
      UPDATE variant_annotations SET acmg_classification = 'Likely benign'
        WHERE acmg_classification IN ('Likely Benign', 'LB');
    `)

    // Step 2: Normalize case_variant_annotations
    db.exec(`
      UPDATE case_variant_annotations SET acmg_classification = 'Likely pathogenic'
        WHERE acmg_classification IN ('Likely Pathogenic', 'LP');
      UPDATE case_variant_annotations SET acmg_classification = 'Uncertain significance'
        WHERE acmg_classification IN ('VUS', 'Uncertain Significance');
      UPDATE case_variant_annotations SET acmg_classification = 'Likely benign'
        WHERE acmg_classification IN ('Likely Benign', 'LB');
    `)

    // Step 3: Recompute acmg_best in cohort_variant_summary
    // The existing AFTER triggers in the database already use sentence case,
    // so we just need to recompute any stale acmg_best values
    const hasSummary = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='cohort_variant_summary'"
    ).get()
    if (hasSummary) {
      db.exec(`
        UPDATE cohort_variant_summary SET acmg_best = (
          SELECT CASE MAX(rank)
            WHEN 5 THEN 'Pathogenic' WHEN 4 THEN 'Likely pathogenic'
            WHEN 3 THEN 'Uncertain significance' WHEN 2 THEN 'Likely benign'
            WHEN 1 THEN 'Benign' ELSE NULL END
          FROM (
            SELECT CASE va.acmg_classification
              WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
              WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
              WHEN 'Benign' THEN 1 ELSE 0 END AS rank
            FROM variant_annotations va
            WHERE va.chr = cohort_variant_summary.chr
              AND va.pos = cohort_variant_summary.pos
              AND va.ref = cohort_variant_summary.ref
              AND va.alt = cohort_variant_summary.alt
              AND va.acmg_classification IS NOT NULL
            UNION ALL
            SELECT CASE cva.acmg_classification
              WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
              WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
              WHEN 'Benign' THEN 1 ELSE 0 END AS rank
            FROM case_variant_annotations cva
            WHERE cva.chr = cohort_variant_summary.chr
              AND cva.pos = cohort_variant_summary.pos
              AND cva.ref = cohort_variant_summary.ref
              AND cva.alt = cohort_variant_summary.alt
              AND cva.acmg_classification IS NOT NULL
          )
        )
      `)
    }
  }
}
```

- [x] **Step 13: Run typecheck to find any remaining old-format references**

Run: `npx tsc --noEmit 2>&1 | head -50`

If there are type errors from files still using `'Likely Pathogenic'`, `'VUS'`, or `'Likely Benign'` as `AcmgClassification`, fix them by updating to canonical values. Search for any remaining hardcoded old values:

Run: `grep -rn "'Likely Pathogenic'\|'VUS'\|'Likely Benign'" src/ --include='*.ts' --include='*.vue' | grep -v node_modules | grep -v filterGroups | grep -v protein | grep -v ClinVar`

Fix any remaining occurrences found.

- [x] **Step 14: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS (some test fixtures may need updating if they use old ACMG values)

If tests fail due to old ACMG label values in fixtures, update those fixtures to use canonical values.

- [x] **Step 15: Commit**

```bash
git add src/shared/config/domain.config.ts src/shared/utils/acmg.ts \
  src/shared/types/ipc-schemas.ts src/main/database/types.ts \
  src/main/database/cohort.ts src/main/database/migrations.ts \
  src/renderer/src/composables/useAnnotations.ts \
  src/renderer/src/utils/filters/constants.ts \
  src/renderer/src/utils/acmg/acmg-calculator.ts \
  tests/shared/utils/acmg.test.ts
git commit -m "fix: canonicalize ACMG labels to ClinVar sentence case

IPC schema accepted 'Likely Pathogenic' (title case) but SQL triggers
used 'Likely pathogenic' (sentence case), causing summary count mismatches.

Standardizes all 13 files to canonical ClinVar format. Adds migration
to normalize existing stored values. IPC schema accepts old formats for
backward compatibility and normalizes on input."
```

---

## Task 3: Fix Cohort Boolean Search Parser

**Files:**
- Create: `src/shared/utils/boolean-search.ts`
- Create: `src/main/database/search/cohort-search-emitter.ts`
- Create: `src/main/database/search/fts5-search-emitter.ts`
- Create: `tests/shared/utils/boolean-search.test.ts`
- Create: `tests/main/database/search/cohort-search-emitter.test.ts`
- Create: `tests/main/database/search/fts5-search-emitter.test.ts`
- Modify: `src/main/database/cohort.ts:318-341`
- Modify: `src/main/database/VariantRepository.ts:660-700`

- [x] **Step 1: Write failing tests for tokenizer + AST parser**

Create `tests/shared/utils/boolean-search.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { tokenize, parse, type AstNode } from '../../../src/shared/utils/boolean-search'

describe('tokenize', () => {
  it('tokenizes single term', () => {
    expect(tokenize('BRCA1')).toEqual([{ type: 'TERM', value: 'BRCA1' }])
  })

  it('tokenizes AND expression', () => {
    expect(tokenize('BRCA1 AND TP53')).toEqual([
      { type: 'TERM', value: 'BRCA1' },
      { type: 'AND' },
      { type: 'TERM', value: 'TP53' },
    ])
  })

  it('tokenizes OR expression', () => {
    expect(tokenize('BRCA1 OR TP53')).toEqual([
      { type: 'TERM', value: 'BRCA1' },
      { type: 'OR' },
      { type: 'TERM', value: 'TP53' },
    ])
  })

  it('tokenizes NOT expression', () => {
    expect(tokenize('NOT BRCA1')).toEqual([
      { type: 'NOT' },
      { type: 'TERM', value: 'BRCA1' },
    ])
  })

  it('tokenizes parenthesized expression', () => {
    expect(tokenize('(BRCA1 OR TP53) AND EGFR')).toEqual([
      { type: 'LPAREN' },
      { type: 'TERM', value: 'BRCA1' },
      { type: 'OR' },
      { type: 'TERM', value: 'TP53' },
      { type: 'RPAREN' },
      { type: 'AND' },
      { type: 'TERM', value: 'EGFR' },
    ])
  })

  it('treats lowercase and/or/not as terms, not operators', () => {
    expect(tokenize('anderson')).toEqual([{ type: 'TERM', value: 'anderson' }])
  })

  it('returns empty array for empty input', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize('   ')).toEqual([])
  })
})

describe('parse', () => {
  it('parses single term', () => {
    const ast = parse(tokenize('BRCA1'))
    expect(ast).toEqual({ type: 'term', value: 'BRCA1' })
  })

  it('parses AND expression', () => {
    const ast = parse(tokenize('BRCA1 AND TP53'))
    expect(ast).toEqual({
      type: 'and',
      left: { type: 'term', value: 'BRCA1' },
      right: { type: 'term', value: 'TP53' },
    })
  })

  it('parses OR expression', () => {
    const ast = parse(tokenize('BRCA1 OR TP53'))
    expect(ast).toEqual({
      type: 'or',
      left: { type: 'term', value: 'BRCA1' },
      right: { type: 'term', value: 'TP53' },
    })
  })

  it('parses NOT expression', () => {
    const ast = parse(tokenize('NOT BRCA1'))
    expect(ast).toEqual({
      type: 'not',
      operand: { type: 'term', value: 'BRCA1' },
    })
  })

  it('respects precedence: NOT > AND > OR', () => {
    // "A OR B AND NOT C" should parse as "A OR (B AND (NOT C))"
    const ast = parse(tokenize('BRCA1 OR TP53 AND NOT EGFR'))
    expect(ast).toEqual({
      type: 'or',
      left: { type: 'term', value: 'BRCA1' },
      right: {
        type: 'and',
        left: { type: 'term', value: 'TP53' },
        right: {
          type: 'not',
          operand: { type: 'term', value: 'EGFR' },
        },
      },
    })
  })

  it('respects explicit parentheses', () => {
    // "(A OR B) AND NOT C"
    const ast = parse(tokenize('(BRCA1 OR TP53) AND NOT EGFR'))
    expect(ast).toEqual({
      type: 'and',
      left: {
        type: 'or',
        left: { type: 'term', value: 'BRCA1' },
        right: { type: 'term', value: 'TP53' },
      },
      right: {
        type: 'not',
        operand: { type: 'term', value: 'EGFR' },
      },
    })
  })

  it('AND binds tighter than OR', () => {
    // "A OR B AND C" -> "A OR (B AND C)"
    const ast = parse(tokenize('A OR B AND C'))
    expect(ast).toEqual({
      type: 'or',
      left: { type: 'term', value: 'A' },
      right: {
        type: 'and',
        left: { type: 'term', value: 'B' },
        right: { type: 'term', value: 'C' },
      },
    })
  })

  it('throws on empty input', () => {
    expect(() => parse([])).toThrow()
  })

  it('throws on unbalanced parentheses', () => {
    expect(() => parse(tokenize('(BRCA1 AND TP53'))).toThrow()
  })

  it('throws on adjacent operators', () => {
    expect(() => parse(tokenize('AND AND'))).toThrow()
  })

  it('throws on trailing operator', () => {
    expect(() => parse(tokenize('BRCA1 AND'))).toThrow()
  })
})
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shared/utils/boolean-search.test.ts`
Expected: FAIL — module does not exist

- [x] **Step 3: Implement tokenizer + recursive descent parser**

Create `src/shared/utils/boolean-search.ts`:

```typescript
/**
 * Boolean search tokenizer and parser.
 *
 * Tokenizes search input into terms and operators (AND/OR/NOT),
 * then parses into a precedence-correct AST: NOT > AND > OR.
 * Supports parentheses for explicit grouping.
 *
 * Operators are case-sensitive uppercase only — "anderson" is a term, not "AND".
 */

// ── Token types ──

export type Token =
  | { type: 'TERM'; value: string }
  | { type: 'AND' }
  | { type: 'OR' }
  | { type: 'NOT' }
  | { type: 'LPAREN' }
  | { type: 'RPAREN' }

// ── AST node types ──

export type AstNode =
  | { type: 'term'; value: string }
  | { type: 'and'; left: AstNode; right: AstNode }
  | { type: 'or'; left: AstNode; right: AstNode }
  | { type: 'not'; operand: AstNode }

// ── Tokenizer ──

const OPERATORS = new Set(['AND', 'OR', 'NOT'])

export function tokenize(input: string): Token[] {
  const trimmed = input.trim()
  if (trimmed === '') return []

  const tokens: Token[] = []
  // Split on whitespace and parentheses, keeping parens as tokens
  const parts = trimmed.match(/\(|\)|[^\s()]+/g) ?? []

  for (const part of parts) {
    if (part === '(') {
      tokens.push({ type: 'LPAREN' })
    } else if (part === ')') {
      tokens.push({ type: 'RPAREN' })
    } else if (OPERATORS.has(part)) {
      tokens.push({ type: part as 'AND' | 'OR' | 'NOT' })
    } else {
      tokens.push({ type: 'TERM', value: part })
    }
  }

  return tokens
}

// ── Recursive descent parser ──
// Precedence (lowest to highest): OR < AND < NOT < TERM/PAREN

export function parse(tokens: Token[]): AstNode {
  if (tokens.length === 0) throw new Error('Empty search expression')

  let pos = 0

  function peek(): Token | undefined {
    return tokens[pos]
  }

  function advance(): Token {
    const token = tokens[pos]
    if (!token) throw new Error('Unexpected end of expression')
    pos++
    return token
  }

  // OR: lowest precedence
  function parseOr(): AstNode {
    let left = parseAnd()
    while (peek()?.type === 'OR') {
      advance() // consume OR
      const right = parseAnd()
      left = { type: 'or', left, right }
    }
    return left
  }

  // AND: medium precedence
  function parseAnd(): AstNode {
    let left = parseNot()
    while (peek()?.type === 'AND') {
      advance() // consume AND
      const right = parseNot()
      left = { type: 'and', left, right }
    }
    return left
  }

  // NOT: high precedence (unary prefix)
  function parseNot(): AstNode {
    if (peek()?.type === 'NOT') {
      advance() // consume NOT
      const operand = parseNot() // NOT is right-associative
      return { type: 'not', operand }
    }
    return parsePrimary()
  }

  // Primary: term or parenthesized expression
  function parsePrimary(): AstNode {
    const token = peek()
    if (!token) throw new Error('Unexpected end of expression')

    if (token.type === 'LPAREN') {
      advance() // consume (
      const node = parseOr()
      const closing = advance()
      if (closing.type !== 'RPAREN') {
        throw new Error('Expected closing parenthesis')
      }
      return node
    }

    if (token.type === 'TERM') {
      advance()
      return { type: 'term', value: token.value }
    }

    throw new Error(`Unexpected token: ${token.type}`)
  }

  const ast = parseOr()

  if (pos < tokens.length) {
    throw new Error(`Unexpected token at position ${pos}: ${tokens[pos]?.type}`)
  }

  return ast
}
```

- [x] **Step 4: Run parser tests**

Run: `npx vitest run tests/shared/utils/boolean-search.test.ts`
Expected: All tests PASS

- [x] **Step 5: Write failing tests for cohort search emitter**

Create `tests/main/database/search/cohort-search-emitter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { emitCohortSearch } from '../../../../src/main/database/search/cohort-search-emitter'
import { tokenize, parse } from '../../../../src/shared/utils/boolean-search'

function emit(input: string) {
  return emitCohortSearch(parse(tokenize(input)))
}

describe('emitCohortSearch', () => {
  it('emits LIKE condition for single term', () => {
    const { sql, params } = emit('BRCA1')
    expect(sql).toContain('LIKE ?')
    expect(params).toEqual(['%BRCA1%'])
  })

  it('emits AND between two terms', () => {
    const { sql, params } = emit('BRCA1 AND TP53')
    expect(sql).toContain('AND')
    expect(params).toEqual(['%BRCA1%', '%TP53%'])
  })

  it('emits OR between two terms', () => {
    const { sql, params } = emit('BRCA1 OR TP53')
    expect(sql).toContain('OR')
    expect(params).toEqual(['%BRCA1%', '%TP53%'])
  })

  it('emits NOT correctly for A OR NOT B', () => {
    const { sql, params } = emit('BRCA1 OR NOT TP53')
    expect(sql).toContain('OR')
    expect(sql).toContain('NOT')
    expect(params).toEqual(['%BRCA1%', '%TP53%'])
    // Verify the SQL is syntactically valid (no "AND NOT" at wrong position)
    expect(sql).not.toMatch(/OR\s+AND\s+NOT/)
  })

  it('handles genomic coordinate pattern', () => {
    const { sql, params } = emit('chr1:12345')
    expect(sql).toContain('chr = ?')
    expect(sql).toContain('pos = ?')
    expect(params).toContain('chr1')
    expect(params).toContain(12345)
  })

  it('handles HGVS pattern', () => {
    const { sql, params } = emit('c.1234A>G')
    expect(sql).toContain('LIKE ?')
    expect(params).toEqual(['%c.1234A>G%'])
  })
})
```

- [x] **Step 6: Run cohort emitter tests to verify they fail**

Run: `npx vitest run tests/main/database/search/cohort-search-emitter.test.ts`
Expected: FAIL — module does not exist

- [x] **Step 7: Create the search directory and implement cohort emitter**

Create `src/main/database/search/cohort-search-emitter.ts`:

```typescript
import type { AstNode } from '../../../shared/utils/boolean-search'

/**
 * Emit LIKE-based SQL from a boolean search AST.
 * Used by cohort search which queries summary table columns.
 */
export function emitCohortSearch(ast: AstNode): { sql: string; params: (string | number)[] } {
  const params: (string | number)[] = []

  function emit(node: AstNode): string {
    switch (node.type) {
      case 'term':
        return emitTerm(node.value, params)
      case 'and':
        return `(${emit(node.left)} AND ${emit(node.right)})`
      case 'or':
        return `(${emit(node.left)} OR ${emit(node.right)})`
      case 'not':
        return `(NOT ${emit(node.operand)})`
    }
  }

  return { sql: emit(ast), params }
}

/**
 * Emit SQL for a single search term.
 * Handles genomic coordinates (chr:pos), HGVS (c./p.), and general LIKE.
 */
function emitTerm(term: string, params: (string | number)[]): string {
  // Genomic coordinate: chr1:12345
  const coordMatch = term.match(/^(chr[0-9XYM]+):(\d+)$/i)
  if (coordMatch) {
    params.push(coordMatch[1], Number(coordMatch[2]))
    return '(chr = ? AND pos = ?)'
  }

  // HGVS pattern: c.1234A>G or p.Val600Glu
  if (/^[cp]\./.test(term)) {
    params.push(`%${term}%`, `%${term}%`)
    return '(cdna LIKE ? OR aa_change LIKE ?)'
  }

  // General LIKE search across summary columns
  params.push(`%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`)
  return `(gene_symbol LIKE ? OR consequence LIKE ? OR func LIKE ? OR omim_id LIKE ?)`
}

- [x] **Step 8: Run cohort emitter tests**

Run: `npx vitest run tests/main/database/search/cohort-search-emitter.test.ts`
Expected: All tests PASS. Fix any param count mismatches.

- [x] **Step 9: Write failing tests for FTS5 emitter**

Create `tests/main/database/search/fts5-search-emitter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { emitFts5Search } from '../../../../src/main/database/search/fts5-search-emitter'
import { tokenize, parse } from '../../../../src/shared/utils/boolean-search'

function emit(input: string) {
  return emitFts5Search(parse(tokenize(input)))
}

describe('emitFts5Search', () => {
  it('emits FTS5 MATCH for single term', () => {
    const { sql, params } = emit('BRCA1')
    expect(sql).toContain('variants_fts MATCH ?')
    expect(params[0]).toContain('BRCA1')
  })

  it('emits AND between two FTS terms', () => {
    const { sql, params } = emit('BRCA1 AND TP53')
    expect(sql).toContain('AND')
    expect(params.length).toBe(2)
  })

  it('emits OR between two FTS terms', () => {
    const { sql, params } = emit('BRCA1 OR TP53')
    expect(sql).toContain('OR')
  })

  it('emits valid SQL for A OR NOT B', () => {
    const { sql, params } = emit('BRCA1 OR NOT TP53')
    expect(sql).toContain('OR')
    expect(sql).toContain('NOT')
    // Must not produce "OR AND NOT"
    expect(sql).not.toMatch(/OR\s+AND\s+NOT/)
  })

  it('handles HGVS pattern with LIKE fallback', () => {
    const { sql, params } = emit('c.1234A>G')
    expect(sql).toContain('LIKE ?')
    expect(params).toContain('%c.1234A>G%')
  })

  it('escapes double quotes in FTS terms', () => {
    const { sql, params } = emit('BRCA"1')
    const ftsParam = params.find((p) => typeof p === 'string' && p.includes('BRCA'))
    expect(ftsParam).toContain('""')
  })
})
```

- [x] **Step 10: Implement FTS5 emitter**

Create `src/main/database/search/fts5-search-emitter.ts`:

```typescript
import type { AstNode } from '../../../shared/utils/boolean-search'

/**
 * Emit FTS5-compatible SQL from a boolean search AST.
 * Used by variant search which uses FTS5 full-text index.
 *
 * Each term becomes an FTS5 MATCH subquery wrapped as
 * `id IN (SELECT rowid FROM variants_fts WHERE variants_fts MATCH ?)`.
 */
export function emitFts5Search(ast: AstNode): { sql: string; params: (string | number)[] } {
  const params: (string | number)[] = []

  function emit(node: AstNode): string {
    switch (node.type) {
      case 'term':
        return emitTerm(node.value, params)
      case 'and':
        return `(${emit(node.left)} AND ${emit(node.right)})`
      case 'or':
        return `(${emit(node.left)} OR ${emit(node.right)})`
      case 'not':
        return `(NOT ${emit(node.operand)})`
    }
  }

  return { sql: emit(ast), params }
}

function emitTerm(term: string, params: (string | number)[]): string {
  // HGVS pattern: fall back to LIKE (FTS5 doesn't index c./p. notation well)
  if (/^[cp]\./.test(term)) {
    params.push(`%${term}%`, `%${term}%`)
    return '(cdna LIKE ? OR aa_change LIKE ?)'
  }

  // FTS5 MATCH with proper quoting
  const escaped = term.replace(/"/g, '""')
  const ftsQuery = `"${escaped}"*`
  params.push(ftsQuery)
  return 'id IN (SELECT rowid FROM variants_fts WHERE variants_fts MATCH ?)'
}
```

- [x] **Step 11: Run FTS5 emitter tests**

Run: `npx vitest run tests/main/database/search/fts5-search-emitter.test.ts`
Expected: All tests PASS

- [x] **Step 12: Replace buildBooleanSearchCondition in cohort.ts**

Modify `src/main/database/cohort.ts`. Add imports at top:

```typescript
import { tokenize, parse } from '../../shared/utils/boolean-search'
import { emitCohortSearch } from './search/cohort-search-emitter'
```

Replace `buildBooleanSearchCondition` method (lines 318-341):

Old:
```typescript
  private buildBooleanSearchCondition(term: string, paramsArray: (string | number)[]): string {
    const parts = term
      .split(/\b(AND|OR|NOT)\b/)
      .map((p) => p.trim())
      .filter((p) => p !== '')

    const sqlParts: string[] = []
    for (const part of parts) {
      if (part === 'AND') {
        sqlParts.push('AND')
      } else if (part === 'OR') {
        sqlParts.push('OR')
      } else if (part === 'NOT') {
        sqlParts.push('AND NOT')
      } else {
        sqlParts.push(this.buildSingleTermCondition(part, paramsArray))
      }
    }

    return `(${sqlParts.join(' ')})`
  }
```

New:
```typescript
  private buildBooleanSearchCondition(term: string, paramsArray: (string | number)[]): string {
    const tokens = tokenize(term)
    if (tokens.length === 0) return '1=1'
    const ast = parse(tokens)
    const { sql, params } = emitCohortSearch(ast)
    paramsArray.push(...params)
    return sql
  }
```

- [x] **Step 13: Replace boolean parsing in VariantRepository.ts**

Modify `src/main/database/VariantRepository.ts`. Add imports:

```typescript
import { tokenize, parse } from '../../shared/utils/boolean-search'
import { emitFts5Search } from './search/fts5-search-emitter'
```

Replace the inline boolean parsing in `applySearchFilter` (the section starting around line 675 with the `for (const part of parts)` loop) with:

```typescript
    // Parse boolean expression into AST and emit FTS5-compatible SQL
    const tokens = tokenize(term)
    if (tokens.length === 0) return query
    const ast = parse(tokens)
    const { sql: boolExpr, params } = emitFts5Search(ast)
```

Then use `boolExpr` and `params` in the raw SQL construction that follows. Keep the existing ranking/ordering logic intact.

- [x] **Step 14: Run all search-related tests**

Run: `npx vitest run tests/shared/utils/boolean-search.test.ts tests/main/database/search/`
Expected: All tests PASS

Then run the full suite to check for regressions:
Run: `npx vitest run`
Expected: All tests PASS

- [x] **Step 15: Commit**

```bash
git add src/shared/utils/boolean-search.ts \
  src/main/database/search/cohort-search-emitter.ts \
  src/main/database/search/fts5-search-emitter.ts \
  src/main/database/cohort.ts src/main/database/VariantRepository.ts \
  tests/shared/utils/boolean-search.test.ts \
  tests/main/database/search/
git commit -m "fix: boolean search parser with correct NOT/AND/OR precedence

buildBooleanSearchCondition appended 'AND NOT' for every NOT token,
producing invalid SQL for 'A OR NOT B'. Replace with shared recursive
descent parser (NOT > AND > OR precedence) and backend-specific emitters
for LIKE-based cohort search and FTS5 variant search."
```

---

## Task 4: Fix setWindowOpenHandler URL Validation

**Files:**
- Create: `src/shared/config/allowed-domains.ts`
- Create: `src/main/utils/url-validation.ts`
- Create: `tests/main/utils/url-validation.test.ts`
- Modify: `src/main/index.ts:74-77`
- Modify: `src/main/ipc/handlers/shell.ts:26-52`

- [x] **Step 1: Write failing tests for URL validation**

Create `tests/main/utils/url-validation.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import {
  isUrlSafeForExternal,
  isDomainAllowed,
  setUserDomains,
  isValidHostname,
} from '../../../src/main/utils/url-validation'

describe('isValidHostname', () => {
  it('accepts valid hostname', () => {
    expect(isValidHostname('example.com')).toBe(true)
  })

  it('accepts subdomain', () => {
    expect(isValidHostname('sub.example.com')).toBe(true)
  })

  it('rejects bare TLD', () => {
    expect(isValidHostname('com')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidHostname('')).toBe(false)
  })

  it('rejects hostname with spaces', () => {
    expect(isValidHostname('example .com')).toBe(false)
  })
})

describe('isDomainAllowed', () => {
  beforeEach(() => {
    setUserDomains([])
  })

  it('allows exact match from built-in list', () => {
    expect(isDomainAllowed('github.com')).toBe(true)
  })

  it('allows subdomain of built-in domain', () => {
    expect(isDomainAllowed('pages.github.com')).toBe(true)
  })

  it('rejects unknown domain', () => {
    expect(isDomainAllowed('evil.com')).toBe(false)
  })

  it('rejects suffix match without dot boundary', () => {
    // "evilgithub.com" should NOT match "github.com"
    expect(isDomainAllowed('evilgithub.com')).toBe(false)
  })

  it('allows user-configured domain', () => {
    setUserDomains(['mylab.org'])
    expect(isDomainAllowed('mylab.org')).toBe(true)
  })

  it('rejects invalid user domains', () => {
    setUserDomains(['com', 'valid.org'])
    // 'com' is rejected by isValidHostname, so 'evil.com' should not be allowed
    expect(isDomainAllowed('evil.com')).toBe(false)
    // 'valid.org' was valid and should work
    expect(isDomainAllowed('valid.org')).toBe(true)
  })
})

describe('isUrlSafeForExternal', () => {
  beforeEach(() => {
    setUserDomains([])
  })

  it('allows https URL to allowed domain', () => {
    expect(isUrlSafeForExternal('https://github.com/repo')).toBe(true)
  })

  it('rejects http URL', () => {
    expect(isUrlSafeForExternal('http://github.com/repo')).toBe(false)
  })

  it('rejects javascript: URL', () => {
    expect(isUrlSafeForExternal('javascript:alert(1)')).toBe(false)
  })

  it('rejects file: URL', () => {
    expect(isUrlSafeForExternal('file:///etc/passwd')).toBe(false)
  })

  it('rejects unknown domain over https', () => {
    expect(isUrlSafeForExternal('https://evil.com/phish')).toBe(false)
  })

  it('rejects malformed URL', () => {
    expect(isUrlSafeForExternal('not a url')).toBe(false)
  })
})
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/utils/url-validation.test.ts`
Expected: FAIL — modules do not exist

- [x] **Step 3: Create allowed-domains config**

Create `src/shared/config/allowed-domains.ts`:

```typescript
/**
 * Built-in domain allowlist for external URL opening.
 * Both setWindowOpenHandler and shell:openExternal IPC use this.
 */
export const ALLOWED_DOMAINS = [
  'github.com',
  'github.io',
  'opensource.org',
  'gnomad.broadinstitute.org',
  'ncbi.nlm.nih.gov',
  'omim.org',
  'genome.ucsc.edu',
  'varsome.com',
  'franklin.genoox.com',
  'deciphergenomics.org',
  'clinicalgenome.org',
  'ensembl.org',
  'grch37.ensembl.org',
] as const
```

- [x] **Step 4: Create URL validation utility**

Create `src/main/utils/url-validation.ts`:

```typescript
import { ALLOWED_DOMAINS } from '../../shared/config/allowed-domains'

/** User-configured additional domains */
let userDomains: string[] = []

/**
 * Validate that a string is a proper hostname (at least two labels).
 */
export function isValidHostname(h: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(h)
}

/**
 * Set user-configured additional domains.
 * Invalid hostnames (bare TLDs, malformed) are filtered out.
 */
export function setUserDomains(domains: string[]): void {
  userDomains = domains.filter(isValidHostname)
}

/**
 * Check if a hostname matches an allowed domain exactly or is a subdomain of it.
 * Uses dot-boundary matching to prevent suffix attacks (evilgithub.com != github.com).
 */
export function isDomainAllowed(hostname: string): boolean {
  const allDomains = [...ALLOWED_DOMAINS, ...userDomains]
  return allDomains.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  )
}

/**
 * Check if a URL is safe to open externally.
 * Requires HTTPS protocol and an allowed domain.
 */
export function isUrlSafeForExternal(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    return isDomainAllowed(parsed.hostname)
  } catch {
    return false
  }
}
```

- [x] **Step 5: Run URL validation tests**

Run: `npx vitest run tests/main/utils/url-validation.test.ts`
Expected: All tests PASS

- [x] **Step 6: Update index.ts setWindowOpenHandler**

Modify `src/main/index.ts`. Add import:

```typescript
import { isUrlSafeForExternal } from './utils/url-validation'
```

Replace lines 74-77:

Old:
```typescript
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
```

New:
```typescript
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isUrlSafeForExternal(url)) {
      setImmediate(() => shell.openExternal(url))
    }
    return { action: 'deny' }
  })
```

- [x] **Step 7: Update shell.ts to use shared utility**

Modify `src/main/ipc/handlers/shell.ts`. Replace local definitions with imports:

Remove the local `ALLOWED_DOMAINS` array (lines 26-41), the local `isDomainAllowed` function (lines 43-52), and the local `userDomains` variable.

Add imports:
```typescript
import { isDomainAllowed, setUserDomains, isUrlSafeForExternal } from '../../utils/url-validation'
```

Update the `shell:updateUserDomains` handler to call the imported `setUserDomains`:
```typescript
userDomains = validated.data
```
becomes:
```typescript
setUserDomains(validated.data)
```

Update the `shell:openExternal` handler to use `isUrlSafeForExternal(validated.data)` instead of inline checks.

- [x] **Step 8: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [x] **Step 9: Commit**

```bash
git add src/shared/config/allowed-domains.ts src/main/utils/url-validation.ts \
  src/main/index.ts src/main/ipc/handlers/shell.ts \
  tests/main/utils/url-validation.test.ts
git commit -m "fix: validate URLs in setWindowOpenHandler before shell.openExternal

shell.openExternal was called with unvalidated URLs from setWindowOpenHandler,
bypassing the HTTPS + domain allowlist enforced in the IPC handler. Extract
shared URL validation utility used by both code paths."
```

---

## Task 5: Scope Annotation Cache by Case/Database

**Files:**
- Modify: `src/renderer/src/composables/useAnnotations.ts:82-260`

- [x] **Step 1: Read the full composable to understand cache structure**

Read `src/renderer/src/composables/useAnnotations.ts` to identify:
- Where `annotationCache` is declared (should be a `shallowRef<Map<string, AnnotationCache>>`)
- Where `loadingStates` is declared
- How `cacheSet` and `cacheGet` work
- What stores provide `dbPath` and `caseId`
- The `loadAnnotationsBatch` function

- [x] **Step 2: Modify variantKey to include scope**

In `src/renderer/src/composables/useAnnotations.ts`, add a scoped key function alongside the existing coordinate-only key:

```typescript
// Coordinate-only key (for IPC communication — server returns these)
function variantKey(chr: string, pos: number, ref: string, alt: string): string {
  return `${chr}:${pos}:${ref}:${alt}`
}

// Scoped key (for local cache — includes db path and case ID)
function scopedKey(dbPath: string, caseId: number, coordKey: string): string {
  return `${dbPath}::${caseId}::${coordKey}`
}
```

- [x] **Step 3: Update all cache reads to use scoped key**

Update `getAnnotations`, `isStarred`, `isGlobalStarred`, `isLoading`, and any other cache-reading functions to construct the scoped key using the current db path and case ID from their respective stores:

```typescript
function getAnnotations(
  chr: string,
  pos: number,
  ref: string,
  alt: string
): AnnotationCache | undefined {
  const dbPath = databaseStore.currentPath
  const caseId = caseStore.currentCaseId
  if (!dbPath || !caseId) return undefined
  return annotationCache.value.get(scopedKey(dbPath, caseId, variantKey(chr, pos, ref, alt)))
}
```

Apply the same pattern to `isStarred`, `isGlobalStarred`, `isLoading`.

- [x] **Step 4: Update all cache writes to use scoped key**

Update `cacheSet` and `setLoading` to use scoped keys:

```typescript
function cacheSet(coordKey: string, value: AnnotationCache): void {
  const dbPath = databaseStore.currentPath
  const caseId = caseStore.currentCaseId
  if (!dbPath || !caseId) return
  const key = scopedKey(dbPath, caseId, coordKey)
  annotationCache.value.set(key, value)
  // ... existing LRU eviction logic using the scoped key
}
```

- [x] **Step 5: Update batch loading to re-key results and guard async races**

Modify `loadAnnotationsBatch` (around line 230-260):

```typescript
  async function loadAnnotationsBatch(caseId: number, variants: VariantCoord[]): Promise<void> {
    if (!api) return
    const dbPath = databaseStore.currentPath
    if (!dbPath) return

    // Filter uncached
    const uncached = variants.filter((v) => {
      const key = scopedKey(dbPath, caseId, variantKey(v.chr, v.pos, v.ref, v.alt))
      return !annotationCache.value.has(key) && loadingStates.value.get(key) !== true
    })
    if (uncached.length === 0) return

    // Mark in-flight with scoped keys
    for (const vk of uncached) {
      const key = scopedKey(dbPath, caseId, variantKey(vk.chr, vk.pos, vk.ref, vk.alt))
      loadingStates.value.set(key, true)
    }

    try {
      const results = await api.annotations.batchGet(caseId, uncached.map((v) => ({
        chr: v.chr, pos: v.pos, ref: v.ref, alt: v.alt,
      })))

      // Re-key results with scope, guard against case/db switch during await
      const currentDbPath = databaseStore.currentPath
      const currentCaseId = caseStore.currentCaseId
      if (currentDbPath !== dbPath || currentCaseId !== caseId) return

      for (const [coordKey, value] of Object.entries(results)) {
        cacheSet(coordKey, value as AnnotationCache)
      }
    } catch (error) {
      logService.warn(
        'Failed to load annotation batch: ' +
          (error instanceof Error ? error.message : String(error)),
        'annotations'
      )
    } finally {
      for (const vk of uncached) {
        const key = scopedKey(dbPath, caseId, variantKey(vk.chr, vk.pos, vk.ref, vk.alt))
        loadingStates.value.set(key, false)
      }
    }
  }
```

- [x] **Step 6: Add cache invalidation watchers**

Add watchers that clear cache on db/case switch:

```typescript
// Clear cache when database changes
watch(() => databaseStore.currentPath, () => {
  annotationCache.value.clear()
  loadingStates.value.clear()
  triggerRef(annotationCache)
  triggerRef(loadingStates)
})

// Clear cache when case changes
watch(() => caseStore.currentCaseId, () => {
  // Don't need to clear entire cache — scoped keys handle isolation
  // But clear loading states to avoid stale in-flight markers
  loadingStates.value.clear()
  triggerRef(loadingStates)
})
```

- [x] **Step 7: Run existing tests**

Run: `npx vitest run tests/renderer/`
Expected: All tests PASS (or identify any tests that mock useAnnotations that need updating)

- [x] **Step 8: Commit**

```bash
git add src/renderer/src/composables/useAnnotations.ts
git commit -m "fix: scope annotation cache by database path and case ID

Cache key was coordinate-only (chr:pos:ref:alt), causing annotations
from one case to bleed into another. Scope keys as dbPath::caseId::coord.
Add async race guard for batch loading and cache invalidation on db/case switch."
```

---

## Task 6: Remaining Security Fixes

**Files:**
- Modify: `src/main/ipc/handlers/auth.ts:88-93`
- Modify: `src/main/services/auth/AuthService.ts:50-91`
- Modify: `package.json` (targeted dep update)

### 6A: Add admin check to auth:listUsers

- [x] **Step 1: Write failing test for unauthorized listUsers**

Add to the existing `tests/main/handlers/auth-handlers.test.ts` (or create a new test if the existing file doesn't cover this):

```typescript
it('auth:listUsers rejects non-admin user', async () => {
  // Login as non-admin user first (create one if needed)
  // Then call listUsers and expect rejection
  const result = await invokeHandler('auth:listUsers')
  // After adding the admin gate, non-admin calls should throw
  expect(result).toHaveProperty('error')
})
```

- [x] **Step 2: Add admin gate to auth:listUsers**

Modify `src/main/ipc/handlers/auth.ts`. Replace lines 88-93:

Old:
```typescript
  ipcMain.handle('auth:listUsers', async () => {
    return wrapHandler(async () => {
      const db = getDb()
      return db.auth.listUsers()
    })
  })
```

New:
```typescript
  ipcMain.handle('auth:listUsers', async () => {
    return wrapHandler(async () => {
      const db = getDb()
      const currentUser = db.user
      if (!currentUser || currentUser.role !== 'admin') {
        throw new Error('Only admins can list users')
      }
      return db.auth.listUsers()
    })
  })
```

### 6B: Make createFirstUser transactional

- [x] **Step 3: Wrap createFirstUser in transaction**

Modify `src/main/services/auth/AuthService.ts:50-91`. Wrap the three database operations in a transaction:

Old (lines 66-84 approximately):
```typescript
    // Store recovery key hash
    this.db
      .prepare('INSERT INTO database_settings (key, value) VALUES (?, ?)')
      .run('recovery_key_hash', recoveryKeyHash)

    // Enable accounts
    this.db
      .prepare(
        "INSERT OR REPLACE INTO database_settings (key, value) VALUES ('accounts_enabled', 'true')"
      )
      .run()

    const result = this.db
      .prepare(
        `INSERT INTO users (username, display_name, password_hash, role, password_changed_at)
         VALUES (?, ?, ?, 'admin', datetime('now'))`
      )
      .run(username, displayName, passwordHash)
```

New:
```typescript
    const createUser = this.db.transaction(() => {
      // Store recovery key hash
      this.db
        .prepare('INSERT INTO database_settings (key, value) VALUES (?, ?)')
        .run('recovery_key_hash', recoveryKeyHash)

      // Enable accounts
      this.db
        .prepare(
          "INSERT OR REPLACE INTO database_settings (key, value) VALUES ('accounts_enabled', 'true')"
        )
        .run()

      return this.db
        .prepare(
          `INSERT INTO users (username, display_name, password_hash, role, password_changed_at)
           VALUES (?, ?, ?, 'admin', datetime('now'))`
        )
        .run(username, displayName, passwordHash)
    })

    const result = createUser()
```

### 6C: Targeted dependency remediation

- [x] **Step 4: Check current vulnerable packages**

Run: `npm audit --json 2>/dev/null | jq '.vulnerabilities | keys'`

- [x] **Step 5: Update only targeted packages**

For `@xmldom/xmldom`:
```bash
npm install @xmldom/xmldom@latest --save-exact
```

For `elliptic` (transitive via `pdbe-molstar`): check if an update to `pdbe-molstar` resolves it. If not, add an `overrides` entry in `package.json`.

Manually review the `package-lock.json` diff to confirm only the targeted packages changed:
```bash
git diff package-lock.json | head -100
```

- [x] **Step 6: Run tests to verify no regressions**

Run: `npx vitest run`
Expected: All tests PASS

- [x] **Step 7: Commit**

```bash
git add src/main/ipc/handlers/auth.ts src/main/services/auth/AuthService.ts \
  package.json package-lock.json
git commit -m "fix: add auth:listUsers admin check, transactional createFirstUser, update vulnerable deps

- auth:listUsers now requires admin role (was unrestricted)
- createFirstUser wraps 3 INSERTs in a transaction (was non-atomic)
- Update @xmldom/xmldom to fix high-severity XML injection (CVE-XXXX)"
```

---

## Final Verification

After all 6 tasks are committed:

- [x] **Run full CI check locally**

```bash
npm run lint && npm run typecheck && npx vitest run
```

Expected: All pass with zero errors.

- [x] **Verify all commits are atomic**

```bash
git log --oneline fix/correctness-security..HEAD
```

Expected: 6 commits, one per task.

- [x] **Create PR**

```bash
gh pr create --title "fix: correctness and security hardening (PR 1/3)" --body "$(cat <<'EOF'
## Summary

First of three stability hardening PRs based on cross-AI code review (Claude + Codex + Gemini).

Fixes 6 correctness bugs and security gaps:
- **Genotype dosage**: `CAST(gt_num AS INTEGER)` truncated `0/1` to `0` — replaced with proper GT-to-dosage CASE expression
- **ACMG labels**: inconsistent title/sentence case across 13 files — canonicalized to ClinVar standard
- **Boolean search**: `AND NOT` appended for every NOT token, producing invalid SQL — replaced with recursive descent parser
- **URL validation**: `setWindowOpenHandler` called `shell.openExternal` without protocol/domain check — now validated
- **Annotation cache**: coordinate-only key caused cross-case annotation bleed — scoped by db+case
- **Security**: `auth:listUsers` admin check, `createFirstUser` transaction, targeted dep updates

## Test plan
- [x] `npm run lint && npm run typecheck` passes
- [x] `npm run test` passes with all new tests
- [x] Verify genotype dosage: import VCF with het calls, run association analysis
- [x] Verify ACMG: existing classifications display correctly after migration
- [x] Verify boolean search: `BRCA1 OR NOT TP53` returns results (not SQL error)
- [x] Verify external links open correctly in browser
- [x] Verify annotations don't bleed across cases
EOF
)"
```
