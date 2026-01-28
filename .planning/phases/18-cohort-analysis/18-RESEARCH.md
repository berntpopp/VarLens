# Phase 18: Cohort Analysis - Research

**Researched:** 2026-01-28
**Domain:** Multi-case variant aggregation, SQL GROUP BY performance, Vue/Vuetify expandable tables
**Confidence:** HIGH

## Summary

Cohort analysis aggregates variants across multiple cases, requiring efficient SQL GROUP BY queries with composite indexes, expandable table UI patterns for drill-down navigation, and flexible search supporting multiple genomic nomenclatures. The standard approach uses raw SQL aggregation (no ORM), Vuetify's v-data-table with expanded slots for inline drill-down, and a hybrid search strategy combining FTS5 for gene symbols with pattern matching for positional/HGVS queries. Performance profiling with EXPLAIN QUERY PLAN and composite indexes on (chr, pos, ref, alt) is critical for 50+ case cohorts.

**Key findings:**
- SQLite GROUP BY with composite indexes handles cohort aggregation efficiently; proper indexing is essential (HIGH confidence)
- Vuetify 3 v-data-table provides expandable row functionality via show-expand prop and expanded slot (HIGH confidence)
- FTS5 dramatically outperforms LIKE queries (20ms vs 1000ms) for gene symbol search; use LIKE for positional patterns (HIGH confidence)
- Navigation pattern: Tab-based top-level navigation is standard for multi-mode genomic tools; sidebar reserved for case selection (MEDIUM confidence)

**Primary recommendation:** Use composite index on (chr, pos, ref, alt) for cohort aggregation, v-data-table with show-expand for drill-down, FTS5 for gene search, and tab-based navigation with cohort as a top-level mode alongside single-case analysis.

## Standard Stack

No new dependencies required. Phase uses existing stack with specific SQLite and Vuetify features.

### Core (Existing)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3-multiple-ciphers | ~12.6.2 | SQLite synchronous queries | Already in use; GROUP BY and aggregation functions are core SQLite features |
| Vuetify 3 | ~3.x | v-data-table component | Already in use; provides expandable row functionality via show-expand prop |
| Vue 3 | ~3.x | Composition API, reactive state | Already in use; tab navigation via v-tabs component |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| N/A | - | No additional libraries needed | Raw SQL aggregation is sufficient |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw SQL GROUP BY | Knex query builder | Unnecessary abstraction; raw SQL is faster and more direct for fixed schema |
| v-data-table expandable rows | Custom accordion component | Reinventing the wheel; Vuetify provides this out of the box |
| FTS5 + LIKE hybrid | Pure LIKE queries | 50x slower for gene search; LIKE needed only for positional patterns |

**Installation:**
```bash
# No new dependencies required
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── main/
│   └── database/
│       └── cohort.ts              # Cohort aggregation queries (new)
├── renderer/src/
│   ├── components/
│   │   ├── CohortView.vue         # Main cohort view (new)
│   │   ├── CohortTable.vue        # Aggregated variant table with expandable rows (new)
│   │   ├── CohortDashboard.vue    # Summary stats (new)
│   │   └── GeneBurdenTable.vue    # Gene-level aggregation (new)
│   └── App.vue                    # Add v-tabs for Case/Cohort modes
└── shared/types/
    └── cohort.ts                  # Cohort types (new)
```

### Pattern 1: SQL Aggregation with Composite Index

**What:** GROUP BY on (chr, pos, ref, alt) to aggregate variants across cases, with composite index for performance.

**When to use:** All cohort queries aggregating by variant identity.

**Example:**
```sql
-- Composite index MUST be created before cohort queries
CREATE INDEX IF NOT EXISTS idx_variants_chr_pos_ref_alt
ON variants(chr, pos, ref, alt);

-- Cohort aggregation query
SELECT
  chr, pos, ref, alt, gene_symbol,
  COUNT(DISTINCT case_id) as carrier_count,
  COUNT(DISTINCT case_id) * 1.0 / :total_cases as cohort_frequency,
  SUM(CASE WHEN gt_num IN ('0/1', '1/0') THEN 1 ELSE 0 END) as het_count,
  SUM(CASE WHEN gt_num = '1/1' THEN 1 ELSE 0 END) as hom_count,
  AVG(gnomad_af) as avg_gnomad_af,
  GROUP_CONCAT(DISTINCT clinvar) as clinvar_values
FROM variants
WHERE case_id IN (SELECT id FROM cases)
GROUP BY chr, pos, ref, alt
ORDER BY carrier_count DESC
LIMIT 100;
```

**Why this works:**
- Composite index enables fast grouping (SQLite uses index to arrange consecutive rows with same chr/pos/ref/alt)
- GROUP BY compares current row to only previous row, not all prior rows (O(n log n) vs O(n²))
- HAVING clause filters aggregated results (e.g., `HAVING carrier_count > 1` for recurrent variants)

**Source:** [SQLite Query Optimizer Overview](https://sqlite.org/optoverview.html), [Composite Indexes - High Performance SQLite](https://highperformancesqlite.com/watch/composite-indexes)

### Pattern 2: Vuetify Expandable Rows for Drill-Down

**What:** v-data-table with show-expand prop and expanded slot to show per-case carrier details inline.

**When to use:** Cohort aggregated variant table where users need to see which specific cases carry each variant.

**Example:**
```vue
<template>
  <v-data-table
    :headers="headers"
    :items="aggregatedVariants"
    :show-expand="true"
    item-value="variantKey"
  >
    <!-- Expanded row content: per-case carriers -->
    <template #expanded-row="{ columns, item }">
      <tr>
        <td :colspan="columns.length">
          <v-table density="compact" class="nested-table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Zygosity</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="carrier in item.carriers" :key="carrier.caseId">
                <td>{{ carrier.caseName }}</td>
                <td>{{ carrier.zygosity }}</td>
                <td>
                  <v-btn size="small" @click="navigateToCase(carrier.caseId, item)">
                    View in Case
                  </v-btn>
                </td>
              </tr>
            </tbody>
          </v-table>
        </td>
      </tr>
    </template>
  </v-data-table>
</template>

<script setup lang="ts">
// item-value="variantKey" ensures Vuetify tracks expanded state correctly
// variantKey should be a unique identifier like "chr1:12345:A:T"
</script>
```

**Key props:**
- `show-expand`: Renders expand icon on each row
- `item-value`: Unique key for row tracking (use chr:pos:ref:alt as composite key)
- `expanded-row` slot: Custom template for expanded content

**Source:** [Vuetify v-data-table API](https://vuetifyjs.com/en/api/v-data-table), [DEV Community: Vuetify expandable rows](https://dev.to/dasdaniel/how-to-create-a-vuelify-data-table-that-has-only-some-expandable-rows-1m9m)

### Pattern 3: Hybrid Search Strategy (FTS5 + LIKE)

**What:** Use FTS5 for gene symbol search (fast), LIKE patterns for positional/HGVS queries (flexible).

**When to use:** Cohort search bar accepting multiple query formats (gene, chr:pos, HGVS).

**Example:**
```typescript
function buildCohortSearchQuery(searchTerm: string): string {
  // Pattern detection
  const isGene = /^[A-Z][A-Z0-9]+$/i.test(searchTerm)
  const isPosition = /^(chr)?(\d{1,2}|X|Y|MT?):(\d+)$/i.test(searchTerm)
  const isHGVS = /^[cp]\./.test(searchTerm)

  if (isGene) {
    // Use FTS5 for gene symbol (20ms vs 1000ms with LIKE)
    return `
      SELECT DISTINCT chr, pos, ref, alt, gene_symbol, ...
      FROM variants
      WHERE id IN (
        SELECT rowid FROM variants_fts WHERE gene_symbol MATCH '${searchTerm}*'
      )
      AND case_id IN (SELECT id FROM cases)
      GROUP BY chr, pos, ref, alt
    `
  } else if (isPosition) {
    // Extract chr and pos, use indexed LIKE
    const [_, chr, pos] = searchTerm.match(/^(?:chr)?(\d{1,2}|X|Y|MT?):(\d+)$/)!
    return `
      SELECT chr, pos, ref, alt, gene_symbol, ...
      FROM variants
      WHERE chr = '${chr}' AND pos = ${pos}
      AND case_id IN (SELECT id FROM cases)
      GROUP BY chr, pos, ref, alt
    `
  } else if (isHGVS) {
    // HGVS notation in cdna or aa_change columns (LIKE query)
    return `
      SELECT chr, pos, ref, alt, gene_symbol, ...
      FROM variants
      WHERE (cdna LIKE '%${searchTerm}%' OR aa_change LIKE '%${searchTerm}%')
      AND case_id IN (SELECT id FROM cases)
      GROUP BY chr, pos, ref, alt
    `
  } else {
    // Fallback: search all text columns with LIKE
    return `
      SELECT chr, pos, ref, alt, gene_symbol, ...
      FROM variants
      WHERE (gene_symbol LIKE '%${searchTerm}%'
         OR cdna LIKE '%${searchTerm}%'
         OR aa_change LIKE '%${searchTerm}%')
      AND case_id IN (SELECT id FROM cases)
      GROUP BY chr, pos, ref, alt
    `
  }
}
```

**Why hybrid:**
- FTS5 is 50x faster for gene names (inverted index vs full table scan)
- Positional queries benefit from composite index (chr, pos, ref, alt)
- HGVS notation is freeform text — LIKE is necessary, but rare query type

**Source:** [SQLite FTS5 Extension](https://www.sqlite.org/fts5.html), [Full-Text Search in SQLite: A Practical Guide](https://medium.com/@johnidouglasmarangon/full-text-search-in-sqlite-a-practical-guide-80a69c3f42a4)

### Pattern 4: Tab-Based Navigation for Cohort Mode

**What:** Top-level v-tabs component in App.vue with "Cases" and "Cohort" tabs.

**When to use:** When app has distinct analysis modes (single-case vs multi-case cohort).

**Example:**
```vue
<template>
  <v-app>
    <v-app-bar>...</v-app-bar>

    <v-navigation-drawer v-model="sidebarOpen">
      <CaseList @case-selected="handleCaseSelected" />
    </v-navigation-drawer>

    <v-main>
      <v-tabs v-model="activeTab" bg-color="primary" dark>
        <v-tab value="case">Case Analysis</v-tab>
        <v-tab value="cohort">Cohort Analysis</v-tab>
      </v-tabs>

      <v-window v-model="activeTab">
        <v-window-item value="case">
          <FilterToolbar :case-id="selectedCaseId" />
          <VariantTable :case-id="selectedCaseId" />
        </v-window-item>

        <v-window-item value="cohort">
          <CohortDashboard />
          <CohortTable />
        </v-window-item>
      </v-window>
    </v-main>
  </v-app>
</template>
```

**Why tabs:**
- Clear visual distinction between analysis modes
- Single navigation drawer (sidebar) for case selection applies to both modes
- Standard pattern in genomic tools (GEMINI command-line has distinct modes; seqr has project-level vs case-level views)
- Vuetify v-tabs + v-window provides built-in state management

**Source:** Based on existing VarLens App.vue structure and Material Design navigation patterns

### Anti-Patterns to Avoid

- **Don't use WHERE for aggregate filtering:** Use HAVING clause after GROUP BY for conditions on aggregated values (e.g., `HAVING COUNT(DISTINCT case_id) > 1` not `WHERE COUNT(...) > 1`)
- **Don't skip the composite index:** GROUP BY without an index on grouped columns triggers a full table scan and temp B-tree creation (100x slower)
- **Don't expand all rows by default:** Expanded rows should be opt-in; auto-expanding all rows defeats pagination and causes layout thrashing
- **Don't create separate modal/page for drill-down:** Inline expansion (expanded-row slot) is faster and more intuitive than navigating away

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Expandable table rows | Custom accordion with v-for | Vuetify v-data-table show-expand | Vuetify handles expand state, animations, accessibility, and item-value tracking automatically |
| Gene symbol search | LIKE queries on gene_symbol | FTS5 (existing variants_fts table) | FTS5 is 50x faster (20ms vs 1000ms) due to inverted index; already configured with prefix search |
| Variant identity grouping | String concatenation keys (chr + pos + ref + alt) | GROUP BY (chr, pos, ref, alt) with composite index | SQLite optimizer uses composite index to avoid temp table creation; guaranteed correct grouping |
| Zygosity parsing from GT | Regex parsing of gt_num strings | SQL CASE expressions on gt_num column | Already stored in database; CASE WHEN gt_num IN ('0/1', '1/0') is O(1) indexed lookup |
| Cohort allele frequency calculation | Application-level array operations | SQL COUNT(DISTINCT case_id) / total_cases | Database aggregation is faster than marshalling data to renderer; single query vs N queries |

**Key insight:** SQLite's GROUP BY with proper indexing and Vuetify's data table primitives solve 90% of cohort analysis needs. Custom solutions introduce bugs (wrong grouping, slow search, broken expand state) and maintenance burden.

## Common Pitfalls

### Pitfall 1: Missing Composite Index on GROUP BY Columns

**What goes wrong:** GROUP BY query without an index on (chr, pos, ref, alt) triggers a full table scan and creates a temporary B-tree for sorting. With 50 cases and 500k variants, this can take 5-10 seconds instead of <100ms.

**Why it happens:** SQLite can only use an index for GROUP BY if grouped columns match index column order from left to right without gaps. A separate index on `chr` alone does NOT help GROUP BY (chr, pos, ref, alt).

**How to avoid:**
1. Create composite index in exact GROUP BY order: `CREATE INDEX idx_variants_chr_pos_ref_alt ON variants(chr, pos, ref, alt);`
2. Verify index usage with `EXPLAIN QUERY PLAN SELECT ... GROUP BY chr, pos, ref, alt` — should say "USING INDEX idx_variants_chr_pos_ref_alt" not "USING TEMP B-TREE FOR GROUP BY"
3. Run `ANALYZE` after creating index to update query planner statistics

**Warning signs:**
- Query time increases dramatically with case count (linear or worse instead of logarithmic)
- EXPLAIN QUERY PLAN shows "TEMP B-TREE FOR GROUP BY"
- Large memory allocation during query execution

**Source:** [SQLite Query Optimizer Overview](https://sqlite.org/optoverview.html), [Composite Indexes - High Performance SQLite](https://highperformancesqlite.com/watch/composite-indexes)

### Pitfall 2: Using WHERE Instead of HAVING for Aggregate Conditions

**What goes wrong:** `WHERE COUNT(DISTINCT case_id) > 1` produces a SQL syntax error. WHERE clause evaluates before grouping, so aggregate functions are not yet available.

**Why it happens:** Confusing the execution order: WHERE → GROUP BY → HAVING → SELECT → ORDER BY. Aggregate functions (COUNT, SUM, AVG) only exist after GROUP BY completes.

**How to avoid:**
```sql
-- WRONG: Syntax error
SELECT chr, pos, ref, alt, COUNT(DISTINCT case_id) as carrier_count
FROM variants
WHERE carrier_count > 1  -- ERROR: unknown column
GROUP BY chr, pos, ref, alt;

-- CORRECT: HAVING clause after GROUP BY
SELECT chr, pos, ref, alt, COUNT(DISTINCT case_id) as carrier_count
FROM variants
GROUP BY chr, pos, ref, alt
HAVING COUNT(DISTINCT case_id) > 1;  -- Filters groups, not rows
```

**Warning signs:**
- SQL error: "misuse of aggregate function"
- SQL error: "no such column: carrier_count"

**Source:** [SQLite HAVING Clause](https://www.tutorialspoint.com/sqlite/sqlite_having_clause.htm), [HAVING vs WHERE](https://www.techonthenet.com/sqlite/having.php)

### Pitfall 3: Not Setting item-value on Expandable Table

**What goes wrong:** Expanding one row collapses others unexpectedly, or expanded state resets after data refresh. Vuetify uses array index as default key, which breaks when items change.

**Why it happens:** Vuetify tracks expanded rows by item-value prop. If not set, Vuetify uses array index (unstable). When data refreshes or table sorts, indexes change and expanded state becomes incorrect.

**How to avoid:**
```vue
<!-- WRONG: No item-value, uses array index -->
<v-data-table :items="variants" show-expand />

<!-- CORRECT: Unique stable key -->
<v-data-table
  :items="variants"
  show-expand
  item-value="variantKey"
/>
<!-- variantKey should be like "chr1:12345:A:T" (stable across refreshes) -->
```

**Warning signs:**
- Expanding row A collapses row B unexpectedly
- Expanded rows collapse after sorting or filtering
- Wrong row expands after data refresh

**Source:** [Vuetify v-data-table API](https://vuetifyjs.com/en/api/v-data-table), Vuetify source code (item-value used internally for tracking selected/expanded state)

### Pitfall 4: Genotype String Representation Mismatch

**What goes wrong:** Counting heterozygous variants with `gt_num = '0/1'` misses variants stored as `'1/0'` (phased VCF notation). Hom-alt count is incorrect.

**Why it happens:** VCF genotype field uses `0/1` (unphased) or `0|1` (phased) notation. Some parsers normalize to `0/1`, others preserve phasing. The gt_num column stores the string as-is from source data.

**How to avoid:**
```sql
-- WRONG: Misses 1/0 and phased variants (0|1, 1|0)
SUM(CASE WHEN gt_num = '0/1' THEN 1 ELSE 0 END) as het_count

-- CORRECT: Handle all het representations
SUM(CASE WHEN gt_num IN ('0/1', '1/0', '0|1', '1|0') THEN 1 ELSE 0 END) as het_count

-- CORRECT: Handle all hom-alt representations
SUM(CASE WHEN gt_num IN ('1/1', '1|1') THEN 1 ELSE 0 END) as hom_count
```

**Warning signs:**
- Het/hom counts don't add up to total carrier count
- Some cases show 0 het variants despite being diploid
- Visual inspection of gt_num shows `1/0` or `0|1` values not matched

**Source:** [VCF Specification v4.5](https://samtools.github.io/hts-specs/VCFv4.5.pdf), [VCF Interpretation - Bioinformatics](https://hoytpr.github.io/bioinformatics-semester/materials/extras/vcf-interpretation/)

### Pitfall 5: FTS5 MATCH Syntax Errors

**What goes wrong:** FTS5 query `gene_symbol MATCH 'BRCA1'` works, but `gene_symbol MATCH 'BRCA-1'` throws "fts5: syntax error near '-'". Dashes are treated as NOT operators in FTS5 query syntax.

**Why it happens:** FTS5 uses a query mini-language where `-` is the NOT operator, `AND`, `OR`, `*` are special. Gene names with dashes (e.g., BRCA-1, HLA-A) or symbols break the parser.

**How to avoid:**
```typescript
// Escape or quote gene symbols for FTS5
function escapeFTS5Query(term: string): string {
  // If contains special chars, wrap in double quotes
  if (/[-*"]/.test(term)) {
    return `"${term.replace(/"/g, '""')}"`;  // Escape internal quotes
  }
  return term;
}

// Usage
const query = `SELECT ... WHERE rowid IN (
  SELECT rowid FROM variants_fts WHERE gene_symbol MATCH '${escapeFTS5Query(searchTerm)}*'
)`;
```

**Warning signs:**
- SQL error: "fts5: syntax error near '-'"
- Search works for some genes but not others
- Errors occur with gene names containing punctuation

**Source:** [SQLite FTS5 Extension - Full-text Query Syntax](https://www.sqlite.org/fts5.html#full_text_query_syntax)

## Code Examples

Verified patterns from official sources and codebase analysis:

### Cohort Aggregation Query with Carrier Details
```typescript
// src/main/database/cohort.ts
interface CohortVariant {
  chr: string
  pos: number
  ref: string
  alt: string
  gene_symbol: string | null
  carrier_count: number
  cohort_frequency: number
  het_count: number
  hom_count: number
  carriers: Array<{ case_id: number; case_name: string; gt_num: string }>
}

export class CohortService {
  private db: Database.Database

  /**
   * Get aggregated variants across all cases with carrier details
   * Uses composite index idx_variants_chr_pos_ref_alt for performance
   */
  getCohortVariants(limit: number = 100, offset: number = 0): CohortVariant[] {
    // Get total case count for frequency calculation
    const totalCases = this.db.prepare('SELECT COUNT(*) as count FROM cases').get() as { count: number }

    // Main aggregation query
    const aggregated = this.db.prepare(`
      SELECT
        chr, pos, ref, alt, gene_symbol,
        COUNT(DISTINCT case_id) as carrier_count,
        COUNT(DISTINCT case_id) * 1.0 / ? as cohort_frequency,
        SUM(CASE WHEN gt_num IN ('0/1', '1/0', '0|1', '1|0') THEN 1 ELSE 0 END) as het_count,
        SUM(CASE WHEN gt_num IN ('1/1', '1|1') THEN 1 ELSE 0 END) as hom_count
      FROM variants
      GROUP BY chr, pos, ref, alt
      ORDER BY carrier_count DESC
      LIMIT ? OFFSET ?
    `).all(totalCases.count, limit, offset) as Omit<CohortVariant, 'carriers'>[]

    // For each variant, get carrier details (separate query to avoid row explosion)
    const carrierStmt = this.db.prepare(`
      SELECT v.case_id, c.name as case_name, v.gt_num
      FROM variants v
      JOIN cases c ON v.case_id = c.id
      WHERE v.chr = ? AND v.pos = ? AND v.ref = ? AND v.alt = ?
    `)

    return aggregated.map(variant => ({
      ...variant,
      carriers: carrierStmt.all(variant.chr, variant.pos, variant.ref, variant.alt) as CohortVariant['carriers']
    }))
  }
}
```

**Source:** Adapted from existing DatabaseService patterns in VarLens codebase

### Gene-Level Burden Aggregation
```typescript
interface GeneBurden {
  gene_symbol: string
  variant_count: number
  affected_case_count: number
  damaging_variant_count: number
  avg_gnomad_af: number | null
}

/**
 * Get gene-level burden: how many variants and cases per gene
 * Only returns genes with actual variant hits (no empty genes)
 */
getGeneBurden(): GeneBurden[] {
  return this.db.prepare(`
    SELECT
      gene_symbol,
      COUNT(*) as variant_count,
      COUNT(DISTINCT case_id) as affected_case_count,
      SUM(
        CASE WHEN consequence IN (
          'missense_variant',
          'frameshift_variant',
          'stop_gained',
          'splice_donor_variant',
          'splice_acceptor_variant'
        ) THEN 1 ELSE 0 END
      ) as damaging_variant_count,
      AVG(gnomad_af) as avg_gnomad_af
    FROM variants
    WHERE gene_symbol IS NOT NULL
    GROUP BY gene_symbol
    HAVING affected_case_count > 1  -- Only genes with variants in multiple cases
    ORDER BY affected_case_count DESC, variant_count DESC
  `).all() as GeneBurden[]
}
```

**Source:** Based on GEMINI gene burden patterns and SQLite GROUP BY best practices

### Vuetify Expandable Row with Zygosity Display
```vue
<!-- src/renderer/src/components/CohortTable.vue -->
<template>
  <v-data-table
    :headers="headers"
    :items="cohortVariants"
    :items-per-page="50"
    :show-expand="true"
    item-value="variantKey"
    density="compact"
    class="elevation-1"
  >
    <!-- Carrier count column -->
    <template #[`item.carrier_count`]="{ value, item }">
      <v-chip size="small" color="primary">
        {{ value }} / {{ totalCases }}
      </v-chip>
    </template>

    <!-- Het/Hom combined column -->
    <template #[`item.zygosity`]="{ item }">
      <span class="text-caption">
        {{ item.het_count }} het<span v-if="item.hom_count > 0"> / {{ item.hom_count }} hom</span>
      </span>
    </template>

    <!-- Cohort frequency as fraction -->
    <template #[`item.cohort_frequency`]="{ value }">
      {{ (value * 100).toFixed(1) }}%
    </template>

    <!-- Expanded row: carrier details -->
    <template #expanded-row="{ columns, item }">
      <tr>
        <td :colspan="columns.length" class="pa-0">
          <v-table density="compact" class="nested-carriers-table">
            <thead>
              <tr>
                <th class="text-left">Case</th>
                <th class="text-left">Zygosity</th>
                <th class="text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="carrier in item.carriers" :key="carrier.case_id">
                <td>{{ carrier.case_name }}</td>
                <td>
                  <v-chip
                    size="x-small"
                    :color="carrier.gt_num.includes('1/1') || carrier.gt_num.includes('1|1') ? 'error' : 'warning'"
                    label
                  >
                    {{ formatZygosity(carrier.gt_num) }}
                  </v-chip>
                </td>
                <td>
                  <v-btn
                    size="small"
                    variant="text"
                    prepend-icon="mdi-open-in-app"
                    @click="viewInCase(carrier.case_id, item)"
                  >
                    View in Case
                  </v-btn>
                </td>
              </tr>
            </tbody>
          </v-table>
        </td>
      </tr>
    </template>
  </v-data-table>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  cohortVariants: CohortVariant[]
  totalCases: number
}

const props = defineProps<Props>()

// Unique key for each variant (stable across refreshes)
const cohortVariantsWithKey = computed(() =>
  props.cohortVariants.map(v => ({
    ...v,
    variantKey: `${v.chr}:${v.pos}:${v.ref}:${v.alt}`
  }))
)

const headers = [
  { title: 'Chr', key: 'chr', sortable: true },
  { title: 'Position', key: 'pos', sortable: true },
  { title: 'Ref', key: 'ref', sortable: false },
  { title: 'Alt', key: 'alt', sortable: false },
  { title: 'Gene', key: 'gene_symbol', sortable: true },
  { title: 'Carriers', key: 'carrier_count', sortable: true },
  { title: 'Frequency', key: 'cohort_frequency', sortable: true },
  { title: 'Het/Hom', key: 'zygosity', sortable: false }
]

function formatZygosity(gtNum: string): string {
  if (gtNum.includes('1/1') || gtNum.includes('1|1')) return 'hom'
  if (gtNum.includes('0/1') || gtNum.includes('1/0') || gtNum.includes('0|1') || gtNum.includes('1|0')) return 'het'
  return gtNum
}

function viewInCase(caseId: number, variant: CohortVariant): void {
  // Switch to case tab, select case, and pre-filter to this variant
  emit('navigate-to-case', { caseId, variant })
}
</script>

<style scoped>
.nested-carriers-table {
  background-color: rgba(0, 0, 0, 0.02);
}
</style>
```

**Source:** Based on Vuetify v-data-table documentation and existing VarLens VariantTable.vue patterns

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate cohort database | Aggregate across cases in single database | GEMINI (2013), VarGenius (2018) | Simpler schema, no data duplication, easier updates |
| Client-side aggregation in JavaScript | SQL GROUP BY on server | Standard since web-based tools (2015+) | 10-100x faster for large datasets |
| LIKE queries for all search | FTS5 for text, indexed lookups for structured | SQLite FTS5 stable (2015) | 50x faster gene search |
| Modal/popup for drill-down | Inline expandable rows | Material Design expansion panels (2014), Vuetify 2.0 (2019) | Faster interaction, better UX |

**Deprecated/outdated:**
- **GEMINI SQLite database per cohort:** GEMINI (2013) created a separate SQLite file for each cohort analysis. Modern approach: single database with case_id foreign keys and GROUP BY queries. Easier to manage, no export/import between databases.
- **Custom accordion components:** Pre-component-library era (pre-2015) required custom JavaScript for expandable tables. Vuetify and Material UI provide this built-in since ~2017.
- **String concatenation for variant identity:** Old tools concatenated `chr + '_' + pos + '_' + ref + '_' + alt` as a grouping key. Modern approach: GROUP BY multiple columns with composite index (cleaner SQL, better performance).

## Open Questions

Things that couldn't be fully resolved:

1. **Performance threshold for materialized views**
   - What we know: Composite index handles 50 cases efficiently (research flag in STATE.md mentions 50+ cases)
   - What's unclear: At what case count (100? 500?) do we need materialized views or summary tables?
   - Recommendation: Implement with indexes first, add performance profiling with EXPLAIN QUERY PLAN in testing. Document actual query times with 50/100/200 cases.

2. **HGVS notation parsing in database**
   - What we know: HGVS notation is stored in cdna and aa_change columns as strings (c.123G>A, p.Val123Ala)
   - What's unclear: Should cohort search support partial HGVS matching (e.g., "Val123" matches p.Val123Ala) or exact substring only?
   - Recommendation: Start with LIKE '%searchterm%' for cdna/aa_change columns. User testing will reveal if more sophisticated parsing is needed.

3. **Cohort definition scope**
   - What we know: Context document specifies "all imported cases" (implicit cohort = all cases in database)
   - What's unclear: Future requirement for user-defined cohorts (subset of cases)?
   - Recommendation: Design queries with `WHERE case_id IN (...)` pattern so cohort filtering can be added later without refactoring.

4. **Pagination strategy for large cohorts**
   - What we know: Existing VariantTable uses cursor pagination with lastId
   - What's unclear: Cursor pagination with GROUP BY is complex (need composite cursor: chr + pos + ref + alt)
   - Recommendation: Start with offset pagination (LIMIT/OFFSET) for cohort table. Only optimize to cursor if performance testing shows need.

## Sources

### Primary (HIGH confidence)
- [SQLite Query Optimizer Overview](https://sqlite.org/optoverview.html) - GROUP BY optimization with indexes
- [SQLite EXPLAIN QUERY PLAN](https://www.sqlite.org/eqp.html) - Query analysis tools
- [Composite Indexes - High Performance SQLite](https://highperformancesqlite.com/watch/composite-indexes) - Multi-column index usage
- [SQLite FTS5 Extension](https://www.sqlite.org/fts5.html) - Full-text search official documentation
- [Vuetify v-data-table API](https://vuetifyjs.com/en/api/v-data-table) - Expandable row props and slots
- [VCF Specification v4.5](https://samtools.github.io/hts-specs/VCFv4.5.pdf) - Genotype representation standards
- VarLens codebase: `src/main/database/DatabaseService.ts`, `src/renderer/src/components/VariantTable.vue`, `src/main/database/schema.ts` - Existing patterns

### Secondary (MEDIUM confidence)
- [SQLite Group By - SQL Knowledge Center](https://www.sql-easy.com/learn/sqlite-group-by/) - GROUP BY best practices
- [SQLite HAVING Clause](https://www.tutorialspoint.com/sqlite/sqlite_having_clause.htm) - Aggregate filtering
- [Full-Text Search in SQLite: A Practical Guide](https://medium.com/@johnidouglasmarangon/full-text-search-in-sqlite-a-practical-guide-80a69c3f42a4) - FTS5 vs LIKE performance
- [DEV Community: Vuetify expandable rows](https://dev.to/dasdaniel/how-to-create-a-vuelify-data-table-that-has-only-some-expandable-rows-1m9m) - Practical v-data-table patterns
- [VCF Interpretation - Bioinformatics](https://hoytpr.github.io/bioinformatics-semester/materials/extras/vcf-interpretation/) - Genotype notation explained
- [GEMINI: Integrative Exploration of Genetic Variation and Genome Annotations](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1003153) - Cohort analysis tool architecture
- [Seqr: A Web-Based Analysis and Collaboration Tool for Rare Disease Genomics](https://www.academia.edu/90793447/Seqr_A_Web_Based_Analysis_and_Collaboration_Tool_for_Rare_Disease_Genomics) - Navigation patterns in genomic tools

### Tertiary (LOW confidence)
- [HGVS Nomenclature 2024](https://genomemedicine.biomedcentral.com/articles/10.1186/s13073-024-01421-5) - HGVS notation standards (2024 update, post-training cutoff)
- [Material Design Navigation Patterns](https://m1.material.io/patterns/navigation.html) - General UI navigation guidance

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Uses only existing dependencies with proven patterns
- Architecture: HIGH - SQLite GROUP BY and Vuetify expandable rows are mature, well-documented features
- Pitfalls: HIGH - Derived from official SQLite documentation and common errors in genomic database tools
- Navigation pattern: MEDIUM - Tab-based approach is standard, but specific implementation is discretionary

**Research date:** 2026-01-28
**Valid until:** 90 days (stable technologies; SQLite and Vuetify core features change slowly)
