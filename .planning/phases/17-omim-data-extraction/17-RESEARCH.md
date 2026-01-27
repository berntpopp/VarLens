# Phase 17: OMIM Data Extraction - Research

**Researched:** 2026-01-27
**Domain:** SQLite schema extension, import pipeline field mapping, Vue/Vuetify table customization
**Confidence:** HIGH

## Summary

Phase 17 extracts OMIM MIM numbers from variant annotation data during import, stores them in the variants table, and displays them as clickable links in the variant table. The implementation follows established patterns from Phases 15-16: FieldMapper multi-value extraction, schema migration via ALTER TABLE, and Phase 15's external link architecture with URL templates and clickable cells.

OMIM data exists at column index 25 in the source JSON (id: "OMIM", dataType: STRING, fromMultiValue: true, no dictionary). Values are arrays with one entry per transcript, containing 6-digit MIM numbers (e.g., '616765', '611395'). The MIM number is gene-based (not disease-based) and should be extracted using the selected transcript index with fallback to first non-null value, identical to the gene_symbol extraction pattern.

**Primary recommendation:** Follow existing FieldMapper.ts pattern for multi-value extraction, add omim_mim_number to migrateVariantsTable (no rebuild FTS5), update externalLinksStore OMIM link from gene search to MIM entry URL, and add OMIM column to variant table headers with inline clickable link (same pattern as gene_symbol column in Phase 15).

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | current | SQLite with native bindings | Already in use, supports ALTER TABLE for schema changes |
| SQLite FTS5 | built-in | Full-text search | Already configured with external content table pattern |
| Node.js Streams | Node 18+ | Transform streams for import pipeline | FieldMapper extends Transform for memory-efficient processing |
| Vue 3 Composition API | 3.x | Reactive UI components | Established in Phase 5-6 for VariantTable.vue |
| Vuetify 3 | 3.x | Data table components | v-data-table-server with custom cell templates via named slots |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Pinia | current | State management | externalLinksStore manages link configurations (Phase 15) |
| TypeScript | 5.x | Type safety | Shared types in src/shared/types/api.ts for Variant interface |

**Installation:**
No new dependencies required. All libraries already in use.

## Architecture Patterns

### Recommended Project Structure
Existing files to modify:
```
src/
├── main/
│   ├── database/
│   │   └── schema.ts              # Add omim_mim_number column + migration
│   └── import/
│       ├── config/
│       │   └── fieldMapping.ts     # Add COLUMN_INDICES.OMIM = 25
│       └── transforms/
│           └── FieldMapper.ts      # Add omim_mim_number extraction
├── renderer/src/
│   ├── components/
│   │   └── VariantTable.vue        # Add OMIM column + clickable cell template
│   └── stores/
│       └── externalLinksStore.ts   # Update OMIM link from gene search to MIM entry
└── shared/types/
    └── api.ts                      # Add omim_mim_number?: string | null to Variant
```

### Pattern 1: Multi-Value Field Extraction from JSON Arrays

**What:** Extract value from array using selected transcript index with fallback
**When to use:** Any field marked fromMultiValue: true in source data (e.g., OMIM, Gene, Impact)
**Example:**
```typescript
// Source: Existing FieldMapper.ts lines 39-45 + 132-166
// OMIM field follows same pattern as gene_symbol extraction
const mapped: MappedVariant = {
  gene_symbol: this.extractValue(
    row,
    COLUMN_INDICES.GENE,      // index 24
    selectedTranscript,
    true,                      // useDictionary
    this.dictionaries.gene
  ) as string | null,
  omim_mim_number: this.extractValue(
    row,
    COLUMN_INDICES.OMIM,      // index 25
    selectedTranscript,
    false,                     // no dictionary for OMIM
    undefined
  ) as string | null
}

private extractValue(
  row: RawVariantRow,
  columnIndex: number,
  transcriptIndex: number,
  useDictionary: boolean,
  dictionary?: Record<string, string>
): string | number | null {
  const value = row[columnIndex]

  // Handle multi-value arrays
  if (Array.isArray(value)) {
    let selected = value[transcriptIndex] ?? value[0] ?? null
    // Handle nested arrays
    if (Array.isArray(selected)) {
      selected = selected[0] ?? null
    }
    return selected
  }
  return value as string | number | null
}
```

### Pattern 2: Schema Migration with ALTER TABLE

**What:** Add new columns to existing tables without rebuilding database
**When to use:** Adding nullable columns to variants table for existing databases
**Example:**
```typescript
// Source: Existing schema.ts lines 106-129
const migrateVariantsTable = (db: Database.Database): void => {
  const columns = db.prepare('PRAGMA table_info(variants)').all() as { name: string }[]
  const existingColumns = new Set(columns.map((c) => c.name))

  const newColumns: [string, string][] = [
    ['gt_num', 'TEXT'],
    ['omim_mim_number', 'TEXT']  // Add this
  ]

  for (const [colName, colType] of newColumns) {
    if (!existingColumns.has(colName)) {
      db.exec(`ALTER TABLE variants ADD COLUMN ${colName} ${colType}`)
    }
  }
}
```

**Key constraints:**
- SQLite ALTER TABLE ADD COLUMN appends column at end
- New columns must be nullable (no NOT NULL constraint without DEFAULT)
- New column is automatically filled with NULL for existing rows
- Operation is instant regardless of table size (no table rewrite)
- Source: [SQLite ALTER TABLE documentation](https://sqlite.org/lang_altertable.html)

### Pattern 3: FTS5 Trigger Update for New Searchable Column

**What:** Update FTS5 triggers to include new column in full-text search index
**When to use:** When adding text columns that users should be able to search
**Example:**
```sql
-- Source: Existing schema.ts lines 83-100 + SQLite FTS5 documentation
-- For external content FTS5 tables, use delete+insert pattern for updates

CREATE TRIGGER variants_fts_ai AFTER INSERT ON variants BEGIN
  INSERT INTO variants_fts(rowid, gene_symbol, consequence, omim_mim_number)
  VALUES (new.id, new.gene_symbol, new.consequence, new.omim_mim_number);
END;

CREATE TRIGGER variants_fts_ad AFTER DELETE ON variants BEGIN
  INSERT INTO variants_fts(variants_fts, rowid, gene_symbol, consequence, omim_mim_number)
  VALUES ('delete', old.id, old.gene_symbol, old.consequence, old.omim_mim_number);
END;

CREATE TRIGGER variants_fts_au AFTER UPDATE ON variants BEGIN
  -- Delete old entry
  INSERT INTO variants_fts(variants_fts, rowid, gene_symbol, consequence, omim_mim_number)
  VALUES ('delete', old.id, old.gene_symbol, old.consequence, old.omim_mim_number);
  -- Insert new entry
  INSERT INTO variants_fts(rowid, gene_symbol, consequence, omim_mim_number)
  VALUES (new.id, new.gene_symbol, new.consequence, new.omim_mim_number);
END;
```

**CRITICAL:** For UPDATE triggers on external content FTS5 tables, use delete+insert pattern, NOT direct UPDATE statements. Direct updates leave stale data in the index.
- Source: [SQLite FTS5 Extension](https://sqlite.org/fts5.html), [SQLite Forum: FTS5 External Content Update](https://sqlite.org/forum/info/ac5fbb99316b3a5f3800e8b6d2db5a5274525e45ab1db0f02396f38e0b5e3e4a)

**FTS5 Table Rebuild Requirement:**
- FTS5 virtual table structure is defined in createFTSTable SQL
- Adding a column requires DROP + CREATE (rebuilds from scratch)
- For existing databases: SQL will fail if user opens database before import (empty variants, no rebuild issue)
- User decision from CONTEXT.md: "Add omim_mim_number to FTS5 full-text search index"

### Pattern 4: Vuetify Data Table Custom Cell Template with Clickable Link

**What:** Custom cell template using named slots for clickable external links
**When to use:** Any column that should link to external database (Phase 15 pattern)
**Example:**
```vue
<!-- Source: Existing VariantTable.vue lines 102-116 (gene_symbol pattern) -->
<!-- OMIM column follows identical pattern -->

<template #[`item.omim_mim_number`]="{ item, value }">
  <span
    v-if="value && resolveOmimLink(value)"
    class="external-link"
    @click="openExternalLink(resolveOmimLink(value)!, $event)"
  >
    {{ value }}
    <v-icon size="x-small" class="external-link__icon">mdi-open-in-new</v-icon>
  </span>
  <span v-else class="text-grey">—</span>
</template>

<script setup lang="ts">
// Direct link builder (no template needed for simple case)
const resolveOmimLink = (mimNumber: string | null): string | null => {
  if (!mimNumber) return null
  return `https://omim.org/entry/${encodeURIComponent(mimNumber)}`
}
</script>

<style scoped>
/* Source: Existing VariantTable.vue lines 496-516 */
.external-link {
  cursor: pointer;
  color: rgb(var(--v-theme-primary));
  transition: background-color 0.2s ease;
  white-space: nowrap;
}

.external-link:hover {
  text-decoration: underline;
}

.external-link--clicked {
  background-color: rgba(var(--v-theme-primary), 0.1);
  border-radius: 2px;
}

.external-link__icon {
  opacity: 0.6;
  margin-left: 2px;
  vertical-align: middle;
}
</style>
```

**Alternative:** Use externalLinksStore URL template system (Phase 15 pattern) if configurability is desired, but direct link builder is simpler for single-purpose column.

### Pattern 5: External Links Store URL Template System

**What:** Configurable external link system using URL templates with variable substitution
**When to use:** Links that users might want to customize or disable (Phase 15 architecture)
**Example:**
```typescript
// Source: externalLinksStore.ts lines 67-75 + resolveUrlTemplate in externalLinks.ts
// Update existing OMIM link configuration from gene search to MIM entry

{
  id: 'omim',
  name: 'OMIM',
  urlTemplate: 'https://omim.org/entry/{mim_number}',  // Change from search to entry
  column: 'gene_symbol',  // Keep on gene_symbol column OR change to 'omim_mim_number'
  requiredFields: ['mim_number'],  // Change from ['gene'] to ['mim_number']
  enabled: true,
  isBuiltIn: true
}

// Add mim_number to VariantLinkData interface in externalLinks.ts
export interface VariantLinkData {
  chr: string | null
  pos: number | null
  ref: string | null
  alt: string | null
  gene_symbol: string | null
  mim_number: string | null  // Add this
}

// Update resolveUrlTemplate variable map
const fieldMap: Record<string, string | number | null> = {
  chr: data.chr,
  pos: data.pos,
  ref: data.ref,
  alt: data.alt,
  gene: data.gene_symbol,
  mim_number: data.mim_number  // Add this
}
```

**User decision from CONTEXT.md:** Remove OMIM gene search link from gene_symbol column, only show OMIM link when MIM number is available. This suggests NOT using externalLinksStore for OMIM (would show on gene column even without MIM number). Direct link in OMIM column is cleaner.

### Anti-Patterns to Avoid

- **Don't rebuild FTS5 table for existing databases:** FTS5 structure requires DROP+CREATE for column changes, but existing databases won't have OMIM data anyway (data comes from import). Only new imports will populate omim_mim_number. If FTS5 rebuild is desired, it must be conditional (check if column exists, rebuild if needed).
- **Don't use UPDATE statements on external content FTS5 tables:** Use delete+insert pattern in triggers to avoid stale index data.
- **Don't add NOT NULL constraint without DEFAULT:** ALTER TABLE ADD COLUMN requires nullable columns unless DEFAULT is specified.
- **Don't assume multi-value arrays are always populated:** OMIM field can be [None, None, None] or None or ['616765', None, '616765']. Always check for null after array access.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Extract value from transcript-indexed array | Custom array logic | FieldMapper.extractValue() | Handles nested arrays, null values, fallback to first non-null, dictionary resolution |
| Build URL from variant data | String concatenation | resolveUrlTemplate() or dedicated builder function | Handles URL encoding, null checks, genome build variations |
| Clickable table cells | Custom event handlers on v-data-table rows | Named slot templates `#[item.column]` | Vuetify standard pattern, works with sorting/pagination, proper event bubbling |
| Add column to existing database | Manual IF NOT EXISTS checks | migrateVariantsTable() pattern | PRAGMA table_info check + ALTER TABLE in loop, idempotent |
| Full-text search indexing | Custom search implementation | SQLite FTS5 with triggers | Unicode-aware, prefix search, integrated with content table |

**Key insight:** The codebase already has patterns for every aspect of this phase. OMIM extraction is a schema extension, not a new feature category. Follow established patterns exactly.

## Common Pitfalls

### Pitfall 1: FTS5 Index Inconsistency After Schema Change

**What goes wrong:** Adding omim_mim_number column to variants table but not updating FTS5 triggers leaves the full-text search index out of sync for new imports.

**Why it happens:** FTS5 virtual table definition is separate from variants table schema. Triggers must explicitly list all searchable columns.

**How to avoid:**
1. Update createFTSTable to include omim_mim_number in column list
2. Update all three FTS triggers (ai, ad, au) to include omim_mim_number
3. For existing databases, FTS5 table must be rebuilt (DROP + CREATE) if column list changes
4. Consider: User opens old database → no omim_mim_number column → FTS5 CREATE fails. Solution: Check if column exists before creating FTS5 table, or make FTS5 rebuild optional.

**Warning signs:** Users search for MIM numbers and get no results despite data being present in variants table.

**User decision from CONTEXT.md:** "Add omim_mim_number to FTS5 full-text search index" — explicitly requested, must handle existing databases gracefully.

### Pitfall 2: Multi-Value Array Extraction Edge Cases

**What goes wrong:** Assuming OMIM arrays are always flat lists like ['616765', '616765'] when they can be nested arrays, all-null arrays, or single None values.

**Why it happens:** Source data structure varies: some variants have [None, '616765', '616765'], others ['616765'], others None.

**How to avoid:**
- Use FieldMapper.extractValue() which already handles nested arrays (lines 148-152)
- Test with actual data: row 4 in test data has [None, '616765', '616765'] (selected transcript 0 returns None, fallback works)
- Validate: Check if selected value is still an array after first access (nested array case)

**Warning signs:** Import crashes with "cannot read property of undefined" when accessing OMIM field, or MIM numbers stored as "[object Object]" instead of string.

### Pitfall 3: External Link Visibility Logic Mismatch

**What goes wrong:** Showing OMIM link on gene_symbol column (Phase 15 pattern) when MIM number is missing, leading to dead links or confusing behavior.

**Why it happens:** Phase 15 external links use column-based attachment (link attaches to gene_symbol column). If OMIM link uses same pattern but requires MIM number, gene cells with no MIM number still show link icon but link resolves to null.

**How to avoid:**
- **Option A (simpler):** Create dedicated OMIM column with inline link, don't use externalLinksStore for OMIM. Link only appears when MIM number exists (v-if="value" check).
- **Option B (consistent with Phase 15):** Keep OMIM link on gene_symbol column but update requiredFields to ['mim_number'], causing resolveUrlTemplate to return null when MIM number missing. Link icon won't appear (consistent with Phase 15 behavior).

**User decision from CONTEXT.md:** "Remove the existing gene symbol → OMIM gene search link" and "Only show OMIM link when variant has a real MIM number stored" strongly suggests Option A (dedicated column).

**Warning signs:** Gene cells show OMIM link icon but clicking does nothing, or users report "OMIM link not working".

### Pitfall 4: ALTER TABLE Column Order Assumptions

**What goes wrong:** Expecting omim_mim_number to appear next to gene_symbol in table, but ALTER TABLE ADD COLUMN always appends at the end.

**Why it happens:** SQLite ALTER TABLE ADD COLUMN appends columns to the end of the column list. Cannot insert columns at specific positions.

**How to avoid:**
- Accept that database column order ≠ display order
- v-data-table headers array controls display order (line 259-286 in VariantTable.vue)
- Place OMIM header next to Gene in headers array regardless of database column position

**Warning signs:** DBeaver or other database tools show omim_mim_number as last column, but this doesn't affect UI.

### Pitfall 5: OMIM MIM Number Format Assumptions

**What goes wrong:** Storing MIM numbers with prefixes like "MIM:616765" or allelic variant suffixes like "616765.0001" when source data only contains base 6-digit numbers.

**Why it happens:** OMIM documentation mentions MIM: prefix and allelic variant format (e.g., 300746.0001), but the source data (verified in test-data/case-892-snv-sample.json.gz) only contains plain 6-digit strings.

**How to avoid:**
- Store exactly what's in source data: plain 6-digit string (e.g., '616765')
- Don't add prefix/suffix processing unless required by actual source data
- URL builder uses plain number: `https://omim.org/entry/616765` (verified format from [OMIM linking documentation](https://www.omim.org/help/linking))

**Warning signs:** MIM numbers stored as "MIM:616765" don't match OMIM entry URL format, links break.

**Validation:** Test data shows OMIM values are strings like '616765', '611395', '171500', '617314' — no prefix, no suffix. Use as-is.

## Code Examples

Verified patterns from official sources:

### Add OMIM Column to Schema (schema.ts)

```typescript
// Source: Existing migrateVariantsTable pattern
const newColumns: [string, string][] = [
  ['gt_num', 'TEXT'],
  ['func', 'TEXT'],
  ['qual', 'REAL'],
  ['hpo_sim_score', 'REAL'],
  ['transcript', 'TEXT'],
  ['cdna', 'TEXT'],
  ['aa_change', 'TEXT'],
  ['hpo_match', 'TEXT'],
  ['moi', 'TEXT'],
  ['omim_mim_number', 'TEXT']  // Add this
]
```

### Add OMIM to FTS5 Index (schema.ts)

```typescript
// Update createFTSTable
export const createFTSTable = `
CREATE VIRTUAL TABLE IF NOT EXISTS variants_fts USING fts5(
  gene_symbol,
  consequence,
  omim_mim_number,
  content='variants',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 1',
  prefix='2 3'
);
`

// Update createFTSTriggers - all three triggers
export const createFTSTriggers = `
CREATE TRIGGER IF NOT EXISTS variants_fts_ai AFTER INSERT ON variants BEGIN
  INSERT INTO variants_fts(rowid, gene_symbol, consequence, omim_mim_number)
  VALUES (new.id, new.gene_symbol, new.consequence, new.omim_mim_number);
END;

CREATE TRIGGER IF NOT EXISTS variants_fts_ad AFTER DELETE ON variants BEGIN
  INSERT INTO variants_fts(variants_fts, rowid, gene_symbol, consequence, omim_mim_number)
  VALUES ('delete', old.id, old.gene_symbol, old.consequence, old.omim_mim_number);
END;

CREATE TRIGGER IF NOT EXISTS variants_fts_au AFTER UPDATE ON variants BEGIN
  INSERT INTO variants_fts(variants_fts, rowid, gene_symbol, consequence, omim_mim_number)
  VALUES ('delete', old.id, old.gene_symbol, old.consequence, old.omim_mim_number);
  INSERT INTO variants_fts(rowid, gene_symbol, consequence, omim_mim_number)
  VALUES (new.id, new.gene_symbol, new.consequence, new.omim_mim_number);
END;
`
```

**CRITICAL for existing databases:** FTS5 virtual table structure change requires DROP + CREATE. Check if column exists before rebuilding:

```typescript
// In initializeSchema, before creating FTS table
const columns = db.prepare('PRAGMA table_info(variants)').all() as { name: string }[]
const hasOmimColumn = columns.some((c) => c.name === 'omim_mim_number')

if (hasOmimColumn) {
  // Rebuild FTS5 table with new column
  db.exec('DROP TABLE IF EXISTS variants_fts')
  db.exec(createFTSTable)

  // Repopulate FTS5 index from existing data
  db.exec(`
    INSERT INTO variants_fts(rowid, gene_symbol, consequence, omim_mim_number)
    SELECT id, gene_symbol, consequence, omim_mim_number FROM variants
  `)

  db.exec(createFTSTriggers)
} else {
  // Old database without OMIM column, use old FTS5 structure
  db.exec(createFTSTable)  // Will use old definition without omim_mim_number
  db.exec(createFTSTriggers)
}
```

**Alternative (simpler):** Don't make OMIM searchable in Phase 17. Add to FTS5 in future schema version when full rebuild is justified by multiple column additions.

### Add OMIM Field Mapping (fieldMapping.ts)

```typescript
// Source: Existing COLUMN_INDICES pattern
export const COLUMN_INDICES = {
  SELECTED_TRANSCRIPT: 1,
  CHR: 9,
  POS: 10,
  REF: 11,
  ALT: 12,
  QUAL: 14,
  GT_NUM: 15,
  FUNC: 20,
  IMPACT: 21,
  GENE: 24,
  OMIM: 25,  // Add this - confirmed from test data
  TRANSCRIPT: 28,
  CDNA: 29,
  AA_CHANGE: 30,
  CADD: 46,
  CLINVAR: 72,
  GNOMAD_AF: 108,
  HPO_SIM_SCORE: 156,
  HPO_MATCH: 157,
  MOI: 162
} as const
```

### Extract OMIM in FieldMapper (FieldMapper.ts)

```typescript
// Source: Existing gene_symbol pattern (lines 39-45)
const mapped: MappedVariant = {
  chr: this.extractValue(row, COLUMN_INDICES.CHR, selectedTranscript, false) as string,
  pos: this.extractValue(row, COLUMN_INDICES.POS, selectedTranscript, false) as number,
  ref: row[COLUMN_INDICES.REF] as string,
  alt: row[COLUMN_INDICES.ALT] as string,
  gene_symbol: this.extractValue(
    row,
    COLUMN_INDICES.GENE,
    selectedTranscript,
    true,
    this.dictionaries.gene
  ) as string | null,
  omim_mim_number: this.extractValue(
    row,
    COLUMN_INDICES.OMIM,
    selectedTranscript,
    false,  // No dictionary for OMIM
    undefined
  ) as string | null,
  // ... rest of fields
}
```

**No changes needed to extractValue() method** — it already handles multi-value arrays with null values correctly.

### Update Variant Interface (src/shared/types/api.ts)

```typescript
// Add omim_mim_number to Variant interface
export interface Variant {
  id: number
  case_id: number
  chr: string
  pos: number
  ref: string
  alt: string
  gene_symbol: string | null
  omim_mim_number: string | null  // Add this
  consequence: string | null
  gnomad_af: number | null
  cadd: number | null
  clinvar: string | null
  gt_num: string | null
  func: string | null
  qual: number | null
  hpo_sim_score: number | null
  transcript: string | null
  cdna: string | null
  aa_change: string | null
  hpo_match: string | null
  moi: string | null
}
```

### Add OMIM Column to Variant Table (VariantTable.vue)

```vue
<template>
  <v-data-table-server
    v-model:page="page"
    v-model:items-per-page="itemsPerPage"
    v-model:sort-by="sortBy"
    :headers="headers"
    :items="variants"
    :items-length="totalCount"
    :loading="loading"
    :items-per-page-options="[25, 50, 100]"
    density="compact"
    multi-sort
    class="elevation-1"
    @update:options="loadVariants"
  >
    <!-- Existing templates... -->

    <!-- OMIM MIM number with clickable link -->
    <template #[`item.omim_mim_number`]="{ value }">
      <span
        v-if="value"
        class="external-link"
        @click="openExternalLink(buildOmimUrl(value), $event)"
      >
        {{ value }}
        <v-icon size="x-small" class="external-link__icon">mdi-open-in-new</v-icon>
      </span>
      <span v-else class="text-grey">—</span>
    </template>
  </v-data-table-server>
</template>

<script setup lang="ts">
// Add to imports
import { ref, watch, computed } from 'vue'
import type { Variant, /* ... */ } from '../../../shared/types/api'

// Add header definition (in headers computed property)
const headers = computed(() => {
  const baseHeaders = [
    { title: 'Chr', key: 'chr', sortable: true },
    { title: 'Position', key: 'pos', sortable: true, align: 'end' as const },
    { title: 'Ref', key: 'ref', sortable: false, width: '100px' },
    { title: 'Alt', key: 'alt', sortable: false, width: '100px' },
    { title: 'GT', key: 'gt_num', sortable: true },
    { title: 'Gene', key: 'gene_symbol', sortable: true },
    { title: 'OMIM', key: 'omim_mim_number', sortable: true, width: '100px' },  // Add here
    { title: 'Func', key: 'func', sortable: true },
    // ... rest of headers
  ]
  return baseHeaders
})

// Add URL builder function
const buildOmimUrl = (mimNumber: string | null): string | null => {
  if (!mimNumber || mimNumber === '') return null
  return `https://omim.org/entry/${encodeURIComponent(mimNumber)}`
}
</script>
```

**Position:** Place OMIM column immediately after Gene column (semantically related — OMIM is gene MIM number).

**Alternative:** Remove OMIM gene search link from externalLinksStore and don't add dedicated column, instead attach MIM entry link to gene_symbol column when MIM number is available. Requires externalLinksStore updates (see Pattern 5).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| OMIM gene search link | Direct MIM entry link | Phase 17 | Users see disease association page directly instead of search results |
| No OMIM data in database | MIM number extracted during import | Phase 17 | Enables direct linking, FTS5 search by MIM number, inline display |
| Manual FTS5 index updates | Trigger-based automatic sync | Phase 2-6 | External content table pattern, delete+insert for updates |
| String concatenation for URLs | URL template system with variable substitution | Phase 15 | Configurable links, genome-build-aware, proper encoding |

**Deprecated/outdated:**
- OMIM gene search link (Phase 15): `https://omim.org/search?search={gene}` → replaced with direct entry link `https://omim.org/entry/{mim_number}` when MIM number is available
- Hardcoded external link URL builders in VariantTable.vue (Phase 1-14): replaced with externalLinksStore configurable system (Phase 15), though simple direct links still acceptable for single-purpose columns

## Open Questions

### 1. FTS5 Rebuild for Existing Databases

**What we know:**
- Adding column to FTS5 virtual table requires DROP + CREATE + repopulation
- Existing databases won't have OMIM data anyway (only new imports populate it)
- User requested "Add omim_mim_number to FTS5 full-text search index"

**What's unclear:**
- Should FTS5 rebuild be automatic on schema initialization, or only when data exists?
- What happens if user opens old database and schema.ts tries to create FTS5 with omim_mim_number column but variants table doesn't have it? (Likely: FTS5 create succeeds, but triggers fail on INSERT because column doesn't exist)

**Recommendation:**
- **Option A (safe):** Conditionally include omim_mim_number in FTS5 only if column exists in variants table. Check with PRAGMA table_info before creating FTS5 table. Use separate createFTSTable SQL strings for old/new schema.
- **Option B (simpler):** Don't add OMIM to FTS5 in Phase 17. Users can still search gene_symbol to find variants, then see MIM number inline. Defer FTS5 update to future phase when multiple columns justify full rebuild.

**Decision required:** Choose Option A or B before planning.

### 2. OMIM Link Column Attachment

**What we know:**
- User requested "Remove the existing gene symbol → OMIM gene search link"
- User requested "Only show OMIM link when variant has a real MIM number stored"
- Phase 15 external links attach to columns (gene_symbol, chr, pos, clinvar) or appear as virtual columns

**What's unclear:**
- Should OMIM link be attached to gene_symbol column (Phase 15 pattern) or be a dedicated OMIM column with inline link?
- If attached to gene_symbol: gene cells show gene name as text, but also have OMIM link icon when MIM number available. Requires externalLinksStore update + VariantLinkData.mim_number.
- If dedicated OMIM column: MIM number is the clickable text (like gene_symbol itself is clickable). Simpler, clearer, no externalLinksStore needed.

**Recommendation:** Dedicated OMIM column with inline link (simpler, clearer). MIM number text is the link, consistent with how gene_symbol text is clickable when gene link is enabled.

**User decision from CONTEXT.md:** "MIM number text itself is the clickable link" — explicitly requested dedicated column approach.

## Sources

### Primary (HIGH confidence)
- Existing codebase patterns:
  - `/home/bernt-popp/development/varlens/src/main/database/schema.ts` - Schema migration pattern, FTS5 configuration
  - `/home/bernt-popp/development/varlens/src/main/import/transforms/FieldMapper.ts` - Multi-value array extraction
  - `/home/bernt-popp/development/varlens/src/renderer/src/components/VariantTable.vue` - Custom cell templates, external links
  - `/home/bernt-popp/development/varlens/src/renderer/src/stores/externalLinksStore.ts` - URL template system
  - `/home/bernt-popp/development/varlens/test-data/case-892-snv-sample.json.gz` - Confirmed OMIM field structure (column 25, STRING, fromMultiValue: true, no dictionary, sample values: '616765', '611395', '171500', '617314')

- Official documentation:
  - [SQLite FTS5 Extension](https://sqlite.org/fts5.html) - External content tables, trigger patterns
  - [SQLite ALTER TABLE](https://sqlite.org/lang_altertable.html) - Column addition constraints
  - [OMIM Linking Help](https://www.omim.org/help/linking) - Direct entry URL format (`https://omim.org/entry/{MIM_NUMBER}`)

### Secondary (MEDIUM confidence)
- [SQLite Forum: FTS5 External Content Update](https://sqlite.org/forum/info/ac5fbb99316b3a5f3800e8b6d2db5a5274525e45ab1db0f02396f38e0b5e3e4a) - Delete+insert pattern for UPDATE triggers
- [simonh.uk: SQLite FTS5 Triggers](https://simonh.uk/2021/05/11/sqlite-fts5-triggers/) - FTS5 external content best practices
- [Vuetify v-data-table discussions](https://github.com/vuetifyjs/vuetify/discussions/14944) - Custom cell click handling via named slots

### Tertiary (LOW confidence)
- MIM number format (6 digits starting with 1-6) inferred from OMIM FAQ and Wikipedia, not official API documentation. Test data confirms plain 6-digit strings in practice.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in use, no new dependencies
- Architecture: HIGH - Exact patterns exist in codebase for every aspect (FieldMapper extraction, schema migration, FTS5 triggers, Vuetify custom cells, external links)
- Pitfalls: HIGH - Known issues from SQLite documentation (FTS5 update pattern, ALTER TABLE constraints) and codebase comments (external content triggers, null handling)
- OMIM MIM number format: MEDIUM - Verified from test data (plain 6-digit strings), URL format verified from OMIM linking documentation
- FTS5 rebuild strategy: MEDIUM - Technical approach clear, but product decision needed (rebuild existing databases or not)

**Research date:** 2026-01-27
**Valid until:** 60 days (stable domain - SQLite, Vue 3, Vuetify 3 are mature; OMIM URL format unlikely to change)
