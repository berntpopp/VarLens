# Phase 20: Annotation Core - Research

**Researched:** 2026-01-28
**Domain:** SQLite-backed variant annotation system with ACMG evidence tracking
**Confidence:** HIGH

## Summary

Phase 20 implements the backend/IPC layer for variant annotations in an Electron desktop app using better-sqlite3, Vue 3, and Vuetify 3. The schema already exists (migration v2) with `variant_annotations` (global) and `case_variant_annotations` (per-case) tables. Research confirms that the project's existing patterns—prepared statement caching, transaction wrapping, and IPC error handling—are optimal for SQLite operations.

ACMG evidence tracking requires storing structured JSON with 28 evidence codes (PVS1, PS1-4, PM1-6, PP1-5, BA1, BS1-4, BP1-7) and variable strength adaptation per ClinGen's modern specifications. The 5-tier classification (Pathogenic, Likely Pathogenic, VUS, Likely Benign, Benign) should use color-coded badges (red/orange → yellow/gray → green/blue spectrum) for visual distinction in the variant table.

Comment markdown rendering should use markdown-it with `html: false` to safely render bold, italic, links, and code without XSS risk. Star/flag UI uses Vuetify's v-icon (mdi-star, mdi-star-outline) with color states. The existing DatabaseService pattern with statement caching and transaction support is production-ready for annotation CRUD operations.

**Primary recommendation:** Build IPC handlers matching existing patterns (wrapHandler, prepared statement caching, transaction wrapping for multi-operation updates). Store ACMG evidence as JSON TEXT column (JSON1 built-in since SQLite 3.38.0). Use markdown-it with html: false for safe markdown rendering.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3-multiple-ciphers | 12.6.2 | Synchronous SQLite with encryption | Already in use, optimal for Electron main process, supports prepared statements and transactions |
| markdown-it | Latest | Markdown parser to HTML | Industry standard, 20k+ stars, safe by default with html: false, extensible |
| Vuetify 3 | 3.11.7 | Material Design components | Already in use, provides v-chip, v-badge, v-icon, color theming |
| Pinia | 2.3.1 | Vue 3 state management | Already in use for stores, reactive annotation state |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @vueuse/core | 14.1.0 | Vue composables | Already in use, provides useDebounce for autosave |
| SQLite JSON1 | Built-in (3.38.0+) | JSON functions | Querying/validating ACMG evidence JSON |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| markdown-it | marked | marked had XSS issues historically, markdown-it safer default |
| JSON TEXT column | JSONB BLOB | JSONB added in 3.45.0 for performance, but JSON TEXT simpler and human-readable for debugging |
| vue3-markdown-it wrapper | Direct markdown-it | Wrapper adds dependency but provides reactive component, defer to implementation phase |

**Installation:**
```bash
npm install markdown-it
npm install --save-dev @types/markdown-it
```

## Architecture Patterns

### Recommended Project Structure
```
src/main/
├── database/
│   ├── schema.ts              # Already has migration v2 tables
│   ├── migrations.ts          # Already created annotation tables
│   ├── DatabaseService.ts     # Extend with annotation methods
│   └── types.ts               # Types already defined (VariantAnnotation, CaseVariantAnnotation, AcmgEvidence)
├── ipc/
│   └── handlers/
│       └── annotations.ts     # NEW: IPC handlers for annotation CRUD
src/renderer/
├── composables/
│   └── useAnnotations.ts      # NEW: Reactive annotation state per variant
├── components/
│   ├── VariantTable.vue       # Extend with star + ACMG columns
│   └── AnnotationPanel.vue    # NEW: Phase 23 side panel (out of scope)
```

### Pattern 1: Prepared Statement Caching (Already Established)
**What:** Cache prepared statements by SQL string in Map, reuse across calls
**When to use:** All annotation CRUD operations
**Example:**
```typescript
// From existing DatabaseService.ts pattern
private stmt(sql: string): Statement {
  let statement = this.statementCache.get(sql)
  if (statement === undefined) {
    statement = this.db.prepare(sql)
    this.statementCache.set(sql, statement)
  }
  return statement
}

// Apply to annotations
getAnnotation(chr: string, pos: number, ref: string, alt: string): VariantAnnotation | null {
  const result = this.stmt(
    'SELECT * FROM variant_annotations WHERE chr = ? AND pos = ? AND ref = ? AND alt = ?'
  ).get(chr, pos, ref, alt) as VariantAnnotation | undefined
  return result ?? null
}
```

### Pattern 2: Transaction Wrapping for Multi-Operation Updates
**What:** Wrap create-or-update operations in transactions for atomicity
**When to use:** Updating annotation with multiple fields (comment + star + ACMG)
**Example:**
```typescript
// From existing DatabaseService.ts
runTransaction<T>(fn: () => T): T {
  try {
    const transactionFn = this.db.transaction(fn)
    return transactionFn()
  } catch (error) {
    throw new TransactionError('Transaction failed', error instanceof Error ? error : undefined)
  }
}

// Apply to annotations
upsertGlobalAnnotation(
  chr: string, pos: number, ref: string, alt: string,
  updates: Partial<Pick<VariantAnnotation, 'global_comment' | 'starred' | 'acmg_classification' | 'acmg_evidence'>>
): void {
  this.runTransaction(() => {
    const existing = this.getAnnotation(chr, pos, ref, alt)
    const now = Date.now()

    if (existing) {
      // UPDATE existing with partial fields
      const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ')
      this.stmt(
        `UPDATE variant_annotations SET ${fields}, updated_at = ? WHERE chr = ? AND pos = ? AND ref = ? AND alt = ?`
      ).run(...Object.values(updates), now, chr, pos, ref, alt)
    } else {
      // INSERT new with defaults
      this.stmt(
        'INSERT INTO variant_annotations (chr, pos, ref, alt, global_comment, starred, acmg_classification, acmg_evidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(chr, pos, ref, alt, updates.global_comment ?? null, updates.starred ?? 0, updates.acmg_classification ?? null, updates.acmg_evidence ?? null, now, now)
    }
  })
}
```

### Pattern 3: IPC Error Handling with wrapHandler
**What:** Wrap all IPC handlers with wrapHandler to serialize errors for renderer
**When to use:** All annotation IPC handlers
**Example:**
```typescript
// From existing handlers/cases.ts pattern
import { wrapHandler } from '../errorHandler'
import { getDatabaseService } from '../../database'

ipcMain.handle('annotations:updateGlobal', async (_event, chr: string, pos: number, ref: string, alt: string, updates: object) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    db.upsertGlobalAnnotation(chr, pos, ref, alt, updates)
    return { success: true }
  })
})
```

### Pattern 4: ACMG Evidence as JSON TEXT Column
**What:** Store AcmgEvidence interface as JSON string in acmg_evidence column
**When to use:** Storing/retrieving ACMG evidence with classification
**Example:**
```typescript
// Type already defined in types.ts
export interface AcmgEvidence {
  pathogenic: string[]  // ['PVS1', 'PS1', 'PM2']
  benign: string[]      // ['BA1', 'BS2']
  notes: string
  classification_date: number
}

// Serialize before storing
const evidence: AcmgEvidence = {
  pathogenic: ['PVS1', 'PM2_Strong'],  // Variable strength: PM2_Strong
  benign: [],
  notes: 'Frameshift in known LOF gene',
  classification_date: Date.now()
}
const jsonString = JSON.stringify(evidence)

// Deserialize after retrieval
const annotation = db.getAnnotation(chr, pos, ref, alt)
const evidence: AcmgEvidence | null = annotation?.acmg_evidence
  ? JSON.parse(annotation.acmg_evidence)
  : null
```

### Pattern 5: Variant Key Lookup (chr:pos:ref:alt)
**What:** Use composite key (chr, pos, ref, alt) to link annotations to variants across cases
**When to use:** All global annotation operations
**Example:**
```typescript
// Global annotations keyed by variant coordinates (not variant.id)
// This allows same variant across multiple cases to share global annotation
function getVariantKey(variant: Variant): string {
  return `${variant.chr}:${variant.pos}:${variant.ref}:${variant.alt}`
}

// Join annotations with variants in query
SELECT v.*, va.global_comment, va.starred, va.acmg_classification, cva.per_case_comment
FROM variants v
LEFT JOIN variant_annotations va ON va.chr = v.chr AND va.pos = v.pos AND va.ref = v.ref AND va.alt = v.alt
LEFT JOIN case_variant_annotations cva ON cva.variant_id = v.id AND cva.case_id = v.case_id
WHERE v.case_id = ?
```

### Anti-Patterns to Avoid
- **Mixing manual COMMIT/ROLLBACK with db.transaction():** better-sqlite3 docs warn these are incompatible
- **Async functions in transactions:** Transactions must complete synchronously (no await inside transaction functions)
- **Storing markdown as HTML:** Store raw markdown text, render on display (security + editability)
- **Global starred as boolean TRUE/FALSE:** SQLite uses INTEGER 0/1, not true/false literals

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Markdown rendering | Custom bold/italic parser | markdown-it with `html: false` | Handles edge cases, link safety, extensible |
| XSS prevention in comments | Manual HTML escaping | markdown-it default config (html: false) | Proven safe, auto-escapes HTML tags |
| ACMG evidence validation | Custom validation logic | JSON schema validator OR trust UI constraints | 28 criteria codes + variable strength = complex, defer validation to UI phase |
| Timestamp handling | Custom date formatters | Store Unix timestamp (ms), format in renderer | Consistent with existing schema (created_at, updated_at) |
| Cascade deletion | Manual DELETE triggers | ON DELETE CASCADE (already in schema) | SQLite handles automatically when case deleted |
| Prepared statement pooling | Custom caching layer | better-sqlite3 + Map cache (already exists) | Optimal pattern, no external library needed |

**Key insight:** better-sqlite3 is synchronous and single-threaded—complexity comes from trying to make it async. Keep all database operations synchronous in main process, expose via async IPC to renderer.

## Common Pitfalls

### Pitfall 1: JSON.stringify() on SQLite INTEGER Columns
**What goes wrong:** Passing JSON.stringify() result to INTEGER column (starred) causes type error
**Why it happens:** Vuetify v-model returns boolean true/false, needs conversion to 0/1
**How to avoid:** Convert boolean to 0/1 before database write
**Warning signs:** Error "datatype mismatch" or starred always null in queries
```typescript
// WRONG
db.stmt('UPDATE variant_annotations SET starred = ? WHERE id = ?').run(JSON.stringify(true), id)

// RIGHT
const starredInt = starred ? 1 : 0
db.stmt('UPDATE variant_annotations SET starred = ? WHERE id = ?').run(starredInt, id)
```

### Pitfall 2: Forgetting updated_at Timestamp
**What goes wrong:** updated_at stays stale after edits, user can't see when comment was last modified
**Why it happens:** UPDATE statements must explicitly set updated_at = ?
**How to avoid:** Always include `updated_at = ?` in UPDATE statements, pass Date.now()
**Warning signs:** created_at and updated_at are identical after multiple edits
```typescript
// WRONG
db.stmt('UPDATE variant_annotations SET global_comment = ? WHERE id = ?').run(comment, id)

// RIGHT
const now = Date.now()
db.stmt('UPDATE variant_annotations SET global_comment = ?, updated_at = ? WHERE id = ?').run(comment, now, id)
```

### Pitfall 3: XSS via Unescaped Markdown Links
**What goes wrong:** User enters `[click me](javascript:alert('XSS'))` in comment, link executes JavaScript
**Why it happens:** markdown-it with `html: true` or custom link rendering without validation
**How to avoid:** Use markdown-it with `html: false` (default), validate link protocols if custom rendering
**Warning signs:** Links allow `javascript:`, `data:`, or `vbscript:` protocols
```typescript
// WRONG (allows XSS)
const md = new MarkdownIt({ html: true })

// RIGHT (safe default)
const md = new MarkdownIt()  // html: false by default
// or explicit
const md = new MarkdownIt({ html: false, linkify: true })
```

### Pitfall 4: Missing Index on Starred Variants Filter
**What goes wrong:** Filtering by starred = 1 scans entire variant_annotations table (slow on large datasets)
**Why it happens:** Partial index `WHERE starred = 1` already exists in migration, but must be used in query
**How to avoid:** Query with `WHERE starred = 1` (not `WHERE starred != 0`) to trigger index
**Warning signs:** EXPLAIN QUERY PLAN shows full table scan instead of index usage
```sql
-- WRONG (full table scan)
SELECT * FROM variant_annotations WHERE starred != 0

-- RIGHT (uses idx_variant_annotations_starred)
SELECT * FROM variant_annotations WHERE starred = 1
```

### Pitfall 5: Race Condition in Upsert (INSERT vs UPDATE)
**What goes wrong:** Concurrent upserts cause UNIQUE constraint violation on (chr, pos, ref, alt)
**Why it happens:** Check-then-insert pattern has race window in single-threaded SQLite
**How to avoid:** Use INSERT OR REPLACE or INSERT ON CONFLICT (SQLite 3.24.0+)
**Warning signs:** Intermittent UNIQUE constraint errors on rapid star toggles
```typescript
// WRONG (race condition)
const existing = db.stmt('SELECT id FROM variant_annotations WHERE chr = ? ...').get(...)
if (existing) {
  db.stmt('UPDATE variant_annotations SET starred = ? WHERE id = ?').run(1, existing.id)
} else {
  db.stmt('INSERT INTO variant_annotations (chr, pos, ref, alt, starred, ...) VALUES (?, ...)').run(...)
}

// RIGHT (atomic upsert)
db.stmt(`
  INSERT INTO variant_annotations (chr, pos, ref, alt, starred, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(chr, pos, ref, alt) DO UPDATE SET starred = excluded.starred, updated_at = excluded.updated_at
`).run(chr, pos, ref, alt, 1, now, now)
```

## Code Examples

Verified patterns from official sources:

### Example 1: Safe Markdown Rendering (markdown-it)
```typescript
// Source: https://github.com/markdown-it/markdown-it/blob/master/docs/security.md
import MarkdownIt from 'markdown-it'

// Safe configuration: html disabled, only markdown syntax
const md = new MarkdownIt({
  html: false,        // Disable raw HTML tags
  linkify: true,      // Auto-convert URLs to links
  typographer: true   // Smart quotes, dashes
})

// Render comment with basic markdown (bold, italic, links, code)
const rendered = md.render(comment)
// <p><strong>bold</strong> <em>italic</em> <code>code</code> <a href="https://example.com">link</a></p>
```

### Example 2: ACMG Evidence JSON Storage
```typescript
// Source: Project types.ts (lines 154-165)
export interface AcmgEvidence {
  pathogenic: string[]
  benign: string[]
  notes: string
  classification_date: number
}

// Variable strength format (ClinGen pattern)
const evidence: AcmgEvidence = {
  pathogenic: ['PVS1', 'PM2_Strong', 'PP3'],  // PM2 upgraded to Strong
  benign: [],
  notes: 'Loss-of-function variant in known disease gene. Rare in gnomAD (PM2 upgraded to Strong per gene-specific VCEP). In silico predictors support pathogenicity (PP3).',
  classification_date: Date.now()
}

// Store as JSON TEXT
db.stmt('UPDATE variant_annotations SET acmg_evidence = ?, updated_at = ? WHERE id = ?')
  .run(JSON.stringify(evidence), Date.now(), annotationId)

// Retrieve and parse
const row = db.stmt('SELECT acmg_evidence FROM variant_annotations WHERE id = ?').get(annotationId)
const parsed: AcmgEvidence = row.acmg_evidence ? JSON.parse(row.acmg_evidence) : null
```

### Example 3: Annotation Upsert with Transaction
```typescript
// Source: DatabaseService.ts transaction pattern (lines 125-132)
upsertGlobalAnnotation(
  chr: string,
  pos: number,
  ref: string,
  alt: string,
  updates: Partial<Pick<VariantAnnotation, 'global_comment' | 'starred' | 'acmg_classification' | 'acmg_evidence'>>
): VariantAnnotation {
  return this.runTransaction(() => {
    const now = Date.now()

    // Atomic upsert using INSERT ON CONFLICT (SQLite 3.24.0+)
    const upsert = this.stmt(`
      INSERT INTO variant_annotations (chr, pos, ref, alt, global_comment, starred, acmg_classification, acmg_evidence, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chr, pos, ref, alt) DO UPDATE SET
        global_comment = COALESCE(excluded.global_comment, global_comment),
        starred = COALESCE(excluded.starred, starred),
        acmg_classification = COALESCE(excluded.acmg_classification, acmg_classification),
        acmg_evidence = COALESCE(excluded.acmg_evidence, acmg_evidence),
        updated_at = excluded.updated_at
      RETURNING *
    `)

    return upsert.get(
      chr, pos, ref, alt,
      updates.global_comment ?? null,
      updates.starred ?? null,
      updates.acmg_classification ?? null,
      updates.acmg_evidence ?? null,
      now, now
    ) as VariantAnnotation
  })
}
```

### Example 4: IPC Handler Pattern
```typescript
// Source: handlers/cases.ts (lines 10-14, adapted for annotations)
import { ipcMain } from 'electron'
import { wrapHandler } from '../errorHandler'
import { getDatabaseService } from '../../database'

ipcMain.handle(
  'annotations:updateGlobalComment',
  async (_event, chr: string, pos: number, ref: string, alt: string, comment: string) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      return db.upsertGlobalAnnotation(chr, pos, ref, alt, { global_comment: comment })
    })
  }
)

ipcMain.handle(
  'annotations:toggleStar',
  async (_event, chr: string, pos: number, ref: string, alt: string, starred: boolean) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      const starredInt = starred ? 1 : 0
      return db.upsertGlobalAnnotation(chr, pos, ref, alt, { starred: starredInt })
    })
  }
)
```

### Example 5: Vuetify Star Icon with Badge
```typescript
// Source: https://vuetifyjs.com/en/components/badges/ + https://vuetifyjs.com/en/components/icons/
<template>
  <!-- Star toggle with global/per-case badge indicator -->
  <v-badge
    :model-value="hasPerCaseStar"
    color="blue"
    icon="mdi-file-document-outline"
    overlap
    offset-x="8"
    offset-y="8"
  >
    <v-icon
      :color="globalStarred ? 'amber' : 'grey-lighten-1'"
      :icon="globalStarred ? 'mdi-star' : 'mdi-star-outline'"
      size="large"
      @click="toggleGlobalStar"
    />
  </v-badge>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const globalStarred = ref(false)
const hasPerCaseStar = ref(false)

async function toggleGlobalStar() {
  globalStarred.value = !globalStarred.value
  await window.annotations.toggleStar(chr, pos, ref, alt, globalStarred.value)
}
</script>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ACMG fixed strength only | ClinGen variable strength (PM2_Strong, PS4_Moderate) | 2020-2023 | Evidence codes now have _Strong, _Moderate, _Supporting suffixes per VCEP specifications |
| Marked.js for markdown | markdown-it | 2015+ | markdown-it safer defaults, no html: true trap, better extensibility |
| JSON TEXT only | JSON TEXT + JSONB BLOB | SQLite 3.45.0 (2024) | JSONB for performance, but JSON TEXT still recommended for human-readable data |
| Manual SQL escaping | Prepared statements | Always | better-sqlite3 auto-escapes, SQL injection impossible with parameterized queries |
| PP5/BP6 (reputable source) | Criteria deprecated | ClinGen SVI 2020 | Removed from framework, don't implement |

**Deprecated/outdated:**
- **PP5/BP6 (reputable source criteria):** ClinGen SVI recommended removal due to subjectivity
- **Fixed ACMG strength levels:** Modern VCEPs use variable strength adaptation (e.g., PM2_Strong)
- **marked.js:** Had XSS vulnerabilities, markdown-it is safer default
- **HTML comments in markdown:** Always store raw markdown, render on display (security + editability)

## Open Questions

Things that couldn't be fully resolved:

1. **ACMG Evidence Code Validation**
   - What we know: 28 total codes (PVS1, PS1-4, PM1-6, PP1-5, BA1, BS1-4, BP1-7) + variable strength suffixes
   - What's unclear: Full list of ClinGen-approved variable strength suffixes per code (e.g., which codes allow _Strong, _Moderate, _Supporting)
   - Recommendation: Store as free-form string array, validate in UI layer (Phase 23) with autocomplete. Backend accepts any string to future-proof for new VCEP specs.

2. **Markdown Character Limit Enforcement**
   - What we know: User decided ~2000 chars for detailed clinical reasoning
   - What's unclear: Hard limit (reject) vs soft limit (warn) vs database constraint (TEXT type = 1GB max)
   - Recommendation: Enforce in UI validation, no database constraint (SQLite TEXT type allows future expansion)

3. **Per-Case Star vs Global Star Priority**
   - What we know: Both exist independently, combined icon shows scope
   - What's unclear: If both starred, which takes precedence in filter/sort operations
   - Recommendation: Filter should show variant if EITHER is starred (OR logic). Sort priority: global star first, then per-case.

4. **ACMG Color Palette Accessibility**
   - What we know: Common pattern is red/orange → yellow/gray → green/blue spectrum
   - What's unclear: Official accessibility guidelines for colorblind users
   - Recommendation: Use Vuetify's built-in color system with semantic names (error/warning/success) + icons for redundancy (not color-only). Defer exact palette to UI implementation phase.

## Sources

### Primary (HIGH confidence)
- [better-sqlite3 official API docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) - Prepared statements, transactions, performance patterns
- [SQLite JSON1 extension docs](https://www.sqlite.org/json1.html) - JSON functions, built-in since 3.38.0
- [markdown-it security docs](https://github.com/markdown-it/markdown-it/blob/master/docs/security.md) - XSS prevention, html: false default
- Project codebase - DatabaseService.ts (lines 48-132), migrations.ts (lines 34-177), types.ts (lines 144-211)

### Secondary (MEDIUM confidence)
- [ACMG/AMP Standards (PMC4544753)](https://pmc.ncbi.nlm.nih.gov/articles/PMC4544753/) - 28 evidence codes, 5-tier classification
- [ClinGen SVI Overview (PMC6885382)](https://pmc.ncbi.nlm.nih.gov/articles/PMC6885382/) - Variable strength adaptation, VCEP specifications
- [Vuetify 3 component docs](https://vuetifyjs.com/en/components/badges/) - v-badge, v-chip, v-icon usage

### Tertiary (LOW confidence)
- [DEV Community: Vue 3 markdown rendering](https://dev.to/matijanovosel/rendering-markdown-in-vue-3-3maj) - vue3-markdown-it wrapper example
- [SQLite performance blog](https://www.powersync.com/blog/sqlite-optimizations-for-ultra-high-performance) - WAL mode, prepared statement benefits
- Generic web search results on ACMG color schemes - No official standard found, common practice varies

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in use except markdown-it (industry standard with 20k+ stars)
- Architecture: HIGH - Patterns verified from existing codebase (DatabaseService, IPC handlers, migrations)
- Pitfalls: HIGH - Identified from better-sqlite3 docs, SQLite behavior, existing code patterns
- ACMG evidence: MEDIUM - Variable strength adaptation documented by ClinGen, but full suffix list not verified
- Color palette: LOW - No official ACMG standard found, common practice varies by implementation

**Research date:** 2026-01-28
**Valid until:** 2026-02-28 (30 days, stable domain)
