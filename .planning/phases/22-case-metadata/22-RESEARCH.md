# Phase 22: Case Metadata - Research

**Researched:** 2026-01-28
**Domain:** Case metadata UI with Vue 3 + Vuetify 3, SQLite many-to-many relationships, filter state persistence
**Confidence:** HIGH

## Summary

Phase 22 implements case metadata management (status, cohort groups, HPO terms) using established patterns from the existing Varlens codebase. The database schema already exists (v0.4.0 migrations), requiring only IPC handlers, composables, and Vue/Vuetify UI components.

**Key findings:**
- Database schema already complete with proper CASCADE DELETE constraints (case_metadata, cohort_groups, case_cohort_links, case_hpo_terms tables)
- Vuetify 3 provides v-combobox for inline cohort creation, v-chip-group for filtering, v-autocomplete for HPO term selection
- VueUse's useStorage composable is available (already in dependencies) for filter persistence
- Atomic upsert pattern (INSERT ON CONFLICT DO UPDATE with COALESCE) already proven in annotation handlers
- better-sqlite3 prepared statement caching pattern already implemented in DatabaseService

**Primary recommendation:** Follow existing patterns from Phase 20 (annotations) for IPC/composable structure. Use v-combobox for inline cohort creation, deterministic color assignment for cohort chips, and VueUse's useStorage for filter persistence.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vue 3 | 3.5.27 | Reactive UI framework | Already used, Composition API |
| Vuetify 3 | 3.11.7 | Material Design components | Already used, v-combobox/v-chip-group/v-autocomplete |
| better-sqlite3-multiple-ciphers | 12.6.2 | Synchronous SQLite with encryption | Already used, prepared statement caching |
| VueUse | 14.1.0 | Composition API utilities | Already in dependencies, useStorage for persistence |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Pinia | 2.3.1 | State management | Only if global filter state needed (likely not) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| useStorage | Manual localStorage | useStorage provides reactivity, serialization, tab sync |
| v-combobox | v-autocomplete + manual add | v-combobox has built-in custom value support |
| Deterministic colors | Stored color in DB | Deterministic approach reduces DB complexity, stays consistent |

**Installation:**
No new dependencies needed - all libraries already installed.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── main/
│   ├── database/
│   │   └── DatabaseService.ts     # Add case metadata methods
│   └── ipc/
│       └── handlers/
│           └── case-metadata.ts   # New IPC handlers
├── renderer/src/
│   └── composables/
│       └── useCaseMetadata.ts     # New composable (follows useAnnotations pattern)
└── shared/types/
    └── (existing api.ts)          # Types already exist in cohort.ts if needed
```

### Pattern 1: Atomic Upsert with COALESCE
**What:** INSERT ON CONFLICT DO UPDATE with COALESCE for partial updates
**When to use:** All metadata mutations (status, cohort assignments, HPO terms)
**Example:**
```typescript
// Source: Existing DatabaseService.ts (upsertGlobalAnnotation)
const result = this.stmt(`
  INSERT INTO case_metadata (case_id, affected_status, notes, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(case_id) DO UPDATE SET
    affected_status = COALESCE(excluded.affected_status, affected_status),
    notes = COALESCE(excluded.notes, notes),
    updated_at = excluded.updated_at
  RETURNING *
`).get(caseId, updates.affected_status ?? null, updates.notes ?? null, now, now)
```

### Pattern 2: Many-to-Many with Junction Table
**What:** case_cohort_links junction table with CASCADE DELETE on both FKs
**When to use:** Cohort assignments (case can have multiple cohorts, cohort can have multiple cases)
**Example:**
```sql
-- Source: Existing migrations.ts (case_cohort_links table)
CREATE TABLE case_cohort_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  cohort_id INTEGER NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY (cohort_id) REFERENCES cohort_groups(id) ON DELETE CASCADE,
  UNIQUE(case_id, cohort_id)
);
```

### Pattern 3: Composable with Optimistic Updates
**What:** Cache state in Map, optimistic UI updates, revert on error
**When to use:** Case metadata operations (mirrors useAnnotations pattern)
**Example:**
```typescript
// Source: Existing useAnnotations.ts pattern
const metadataCache = ref<Map<number, CaseMetadata>>(new Map())

async function updateStatus(caseId: number, status: AffectedStatus): Promise<void> {
  const current = metadataCache.value.get(caseId)
  const previousStatus = current?.affected_status

  // Optimistic update
  if (current) {
    current.affected_status = status
  }

  try {
    const updated = await window.api.caseMetadata.upsert(caseId, { affected_status: status })
    metadataCache.value.set(caseId, updated)
  } catch (error) {
    // Revert on error
    if (current) {
      current.affected_status = previousStatus
    }
  }
}
```

### Pattern 4: Filter Persistence with VueUse
**What:** useStorage composable for reactive localStorage persistence
**When to use:** Filter state (status, cohort, HPO selections)
**Example:**
```typescript
// Source: VueUse documentation + existing codebase localStorage usage
import { useStorage } from '@vueuse/core'

const filterState = useStorage('varlens-case-filters', {
  status: [] as string[],
  cohorts: [] as number[],
  hpoTerms: [] as string[]
}, localStorage, {
  mergeDefaults: true  // Merge with defaults instead of replacing
})
```

### Pattern 5: Deterministic Color Assignment
**What:** Hash string to consistent HSL color using simple algorithm
**When to use:** Auto-assigning colors to cohort groups on creation
**Example:**
```typescript
// Source: Hash-based color generation pattern (common approach)
function stringToColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }

  // Use predefined palette for better aesthetics
  const colors = ['primary', 'secondary', 'success', 'info', 'warning', 'purple', 'pink', 'indigo', 'teal', 'cyan']
  return colors[Math.abs(hash) % colors.length]
}
```

### Anti-Patterns to Avoid
- **Storing colors in database:** Hash-based generation is deterministic and reduces DB complexity
- **Manual filter state management:** VueUse's useStorage handles serialization, reactivity, tab sync automatically
- **Non-atomic updates:** Always use INSERT ON CONFLICT for race-free metadata updates
- **Not using PRAGMA foreign_keys:** Database already enables this, but verify for tests

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Filter persistence | Custom localStorage logic | VueUse's useStorage | Handles serialization, reactivity, mergeDefaults, tab sync |
| Inline tag creation | Custom autocomplete logic | v-combobox with multiple + chips | Built-in custom value support, chip rendering |
| Color assignment | Random colors or manual picker | Deterministic hash-based palette | Consistent across sessions, no DB storage needed |
| Optimistic updates | Manual state tracking | Map-based cache pattern | Already proven in useAnnotations, handles reverts |
| Many-to-many queries | Manual JOIN logic | Prepared statements with proper indexes | better-sqlite3 caching handles performance |

**Key insight:** Vuetify 3 components and VueUse composables handle most UI complexity. Focus on replicating existing DatabaseService/IPC/composable patterns from Phase 20.

## Common Pitfalls

### Pitfall 1: Forgetting PRAGMA foreign_keys in Tests
**What goes wrong:** CASCADE DELETE doesn't work, junction table entries orphaned
**Why it happens:** SQLite disables foreign keys by default for backwards compatibility
**How to avoid:** DatabaseService constructor already runs `this.db.pragma('foreign_keys = ON')` - verify this in test setup
**Warning signs:** Deleting a case leaves case_cohort_links or case_hpo_terms entries behind

### Pitfall 2: v-combobox vs v-autocomplete Confusion
**What goes wrong:** Using v-autocomplete when inline creation is needed
**Why it happens:** Similar APIs but v-autocomplete doesn't allow custom values
**How to avoid:** Use v-combobox for cohort assignment (allows typing new names), v-autocomplete for HPO (fixed vocabulary from API)
**Warning signs:** Can't type new cohort names, only select from existing

### Pitfall 3: Not Using Prepared Statement Caching
**What goes wrong:** Performance degradation on repeated queries
**Why it happens:** Calling db.prepare() directly instead of this.stmt()
**How to avoid:** DatabaseService.stmt() method already caches - always use it
**Warning signs:** Slow metadata operations despite indexes

### Pitfall 4: Filter State Serialization
**What goes wrong:** Complex objects (like Date) don't serialize to localStorage
**Why it happens:** JSON.stringify doesn't handle all types
**How to avoid:** Store simple primitives (strings, numbers, arrays of primitives). VueUse's useStorage handles this automatically.
**Warning signs:** Filter state lost on page reload

### Pitfall 5: Vuetify 3 surface-variant Theme Issue
**What goes wrong:** White-on-white text when using bg-surface-variant (warm palette theme)
**Why it happens:** Project uses warm palette where surface-variant (#f5f2ef) is too close to surface (#faf8f6)
**How to avoid:** Use bg-grey-lighten-3 for subtle contrast or secondary for strong contrast (per CLAUDE.md)
**Warning signs:** Invisible text on backgrounds

### Pitfall 6: v-chip-group v-model with Arrays
**What goes wrong:** v-chip-group selection not working when using array as value
**Why it happens:** Known bug in Vuetify 3.3.11 (Issue #18855)
**How to avoid:** Test chip-group selection carefully, may need workaround or upgrade
**Warning signs:** Chips don't respond to clicks, selected state not updating

## Code Examples

Verified patterns from official sources and existing codebase:

### IPC Handler Pattern (from existing annotations.ts)
```typescript
// Source: src/main/ipc/handlers/annotations.ts
import { ipcMain } from 'electron'
import { wrapHandler } from '../errorHandler'
import { getDatabaseService } from '../../database'

ipcMain.handle(
  'case-metadata:upsert',
  async (_event, caseId: number, updates: CaseMetadataUpdates) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      return db.upsertCaseMetadata(caseId, updates)
    })
  }
)
```

### Cohort List Query with JOIN
```typescript
// Fetch all cohorts for a case (many-to-many query)
getCaseCohorts(caseId: number): CohortGroup[] {
  return this.stmt(`
    SELECT cg.* FROM cohort_groups cg
    JOIN case_cohort_links ccl ON cg.id = ccl.cohort_id
    WHERE ccl.case_id = ?
    ORDER BY cg.name ASC
  `).all(caseId) as CohortGroup[]
}
```

### Cohort Assignment (Junction Table Insert)
```typescript
// Atomic cohort assignment with upsert
assignCohort(caseId: number, cohortId: number): void {
  this.stmt(`
    INSERT INTO case_cohort_links (case_id, cohort_id)
    VALUES (?, ?)
    ON CONFLICT(case_id, cohort_id) DO NOTHING
  `).run(caseId, cohortId)
}
```

### HPO Term Assignment
```typescript
// Atomic HPO term assignment with label caching
assignHpoTerm(caseId: number, hpoId: string, hpoLabel: string): void {
  this.stmt(`
    INSERT INTO case_hpo_terms (case_id, hpo_id, hpo_label, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(case_id, hpo_id) DO UPDATE SET hpo_label = excluded.hpo_label
  `).run(caseId, hpoId, hpoLabel, Date.now())
}
```

### Vuetify v-combobox for Inline Cohort Creation
```vue
<!-- Source: Vuetify 3 documentation pattern -->
<v-combobox
  v-model="selectedCohorts"
  :items="existingCohorts"
  item-title="name"
  item-value="id"
  multiple
  chips
  closable-chips
  density="compact"
  variant="outlined"
  placeholder="Type to create or select cohorts..."
  @update:model-value="handleCohortsChanged"
/>
```

### Status Icon Component Pattern
```vue
<!-- Minimal icon-only status indicator for case list -->
<v-icon
  :icon="statusIcon(caseItem.status)"
  :color="statusColor(caseItem.status)"
  size="small"
/>

<script setup lang="ts">
const statusIcon = (status: AffectedStatus) => {
  return {
    affected: 'mdi-account-alert',
    unaffected: 'mdi-account-check',
    unknown: 'mdi-help-circle-outline'
  }[status]
}

const statusColor = (status: AffectedStatus) => {
  return {
    affected: 'error',      // Red
    unaffected: 'success',  // Green
    unknown: 'grey'         // Grey
  }[status]
}
</script>
```

### Filter State Persistence
```typescript
// Source: VueUse useStorage pattern
import { useStorage } from '@vueuse/core'

const caseFilters = useStorage('varlens-case-filters', {
  status: [] as string[],
  cohortIds: [] as number[],
  hpoIds: [] as string[]
}, localStorage, {
  mergeDefaults: true,
  writeDefaults: true
})

// Automatically persists on any change
caseFilters.value.status.push('affected')
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual localStorage | VueUse useStorage | Vue 3 Composition API era | Automatic reactivity, serialization, tab sync |
| v-select with dialog | v-combobox | Vuetify 3.0+ | Inline creation, better UX |
| Stored colors in DB | Hash-based deterministic | Modern tag systems | Simpler schema, consistent colors |
| Manual optimistic updates | Map-based cache pattern | Modern state management | Race-free, revertible |

**Deprecated/outdated:**
- Vuetify 2 v-chip filtering approach: Vuetify 3 uses v-chip-group with filter prop
- Manual localStorage JSON parsing: VueUse handles serialization automatically
- Creating cohort assignment dialogs: v-combobox provides inline creation

## Open Questions

Things that couldn't be fully resolved:

1. **HPO Autocomplete API Integration**
   - What we know: Phase 21 will provide HpoApiClient with search(query, maxResults) method
   - What's unclear: Exact response format and caching behavior (Phase 21 PLAN.md shows tuple format)
   - Recommendation: Use Phase 21's IPC handler once available, verify response shape in integration

2. **Filter State Scope**
   - What we know: CONTEXT.md says "Claude's discretion" for filter persistence
   - What's unclear: Should filters persist per-database or globally across all databases?
   - Recommendation: Per-database persistence (more intuitive), use database path in localStorage key

3. **Cohort Color Palette Size**
   - What we know: Deterministic hash-based color assignment is standard
   - What's unclear: How many colors in palette before repeats?
   - Recommendation: Use 10-12 Vuetify theme colors, accept repeats after exhaustion (rare in practice)

## Sources

### Primary (HIGH confidence)
- Existing Varlens codebase: src/main/database/DatabaseService.ts (upsert patterns, prepared statements)
- Existing Varlens codebase: src/main/database/migrations.ts (schema definitions, CASCADE DELETE)
- Existing Varlens codebase: src/renderer/src/composables/useAnnotations.ts (composable pattern, optimistic updates)
- Existing Varlens codebase: CLAUDE.md (Vuetify 3 theme warnings)
- [SQLite Foreign Keys Documentation](https://sqlite.org/foreignkeys.html) - Official SQLite docs on CASCADE DELETE
- [VueUse useStorage Documentation](https://vueuse.org/core/usestorage/) - Official useStorage API and examples

### Secondary (MEDIUM confidence)
- [Vuetify 3 Combobox Component](https://vuetifyjs.com/en/components/combobox/) - Official component docs (WebFetch failed but search confirmed features)
- [Vuetify 3 Chip Group Component](https://vuetifyjs.com/en/components/chip-groups/) - Official component docs (filter prop, multiple selection)
- [Vuetify 3 Autocomplete Component](https://vuetifyjs.com/en/components/autocompletes/) - Official component docs (multiple + chips)
- [SQLite UPSERT Documentation](https://sqlite.org/lang_upsert.html) - Official UPSERT syntax and COALESCE pattern
- [better-sqlite3 Performance Best Practices](https://www.powersync.com/blog/sqlite-optimizations-for-ultra-high-performance) - Prepared statement caching, WAL mode
- [Hash-based Color Generation](https://github.com/zenozeng/color-hash) - Deterministic color assignment pattern

### Tertiary (LOW confidence)
- [Material Design Color Palette](https://materialui.co/colors) - Color naming conventions (needs verification with Vuetify 3)
- [Vuetify 3 Color Helpers](https://vuetifyjs.com/en/styles/colors/) - bg-color/text-color patterns (known bug in 3.9.2)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in package.json, patterns proven in codebase
- Architecture: HIGH - Existing DatabaseService, IPC, and composable patterns directly applicable
- Pitfalls: HIGH - Based on actual codebase patterns and official SQLite docs
- UI Components: MEDIUM - Vuetify 3 docs confirmed via search, WebFetch failed but features verified
- Color assignment: MEDIUM - Pattern well-established but implementation details are Claude's discretion

**Research date:** 2026-01-28
**Valid until:** 30 days (stable domain - Vue 3, Vuetify 3, SQLite patterns)
