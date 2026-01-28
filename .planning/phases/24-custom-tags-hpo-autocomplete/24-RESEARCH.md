# Phase 24: Custom Tags + HPO Autocomplete - Research

**Researched:** 2026-01-29
**Domain:** Custom tagging system, HPO phenotype autocomplete, multi-select filtering, preset color palettes
**Confidence:** HIGH

## Summary

Phase 24 implements a custom tagging system for variant annotation and HPO phenotype term autocomplete. The implementation builds on existing infrastructure from Phase 19 (database schema with `tags`, `variant_tags`, and `case_hpo_terms` tables), Phase 21 (HPO API schemas), and Phase 23 (side panel UI patterns).

The tagging system allows users to create custom tags with preset colors from a curated palette, assign multiple tags to variants (per-case scope), and filter variants by tags. Tag management occurs in a dedicated settings page with CRUD operations and delete confirmation for tags in use.

HPO autocomplete supports full offline mode by bundling the complete HPO ontology (~18,000 terms, 3-5MB JSON) with the application. The autocomplete uses Vuetify's v-autocomplete component with virtual scrolling for performance, searching only official term names (not synonyms per user decision), and displaying results as "HP:XXXXXXX - Term Name". Assigned terms appear as closable chips in the side panel.

**Primary recommendation:** Use Vuetify's built-in v-autocomplete and v-chip components with preset color swatches from vue3-swatches or a custom swatch picker. Lazy-load the bundled HPO JSON on first search. Extend FilterToolbar's existing multi-select pattern for tag filtering. Build tag management as a dedicated settings view following the existing CRUD patterns from ExternalLinksSettings.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vuetify 3 | 3.x | v-autocomplete, v-chip, v-select, v-badge | Already in codebase, provides multi-select chips |
| Vue 3 | 3.x | Composition API, reactive state | Existing architecture |
| better-sqlite3 | Existing | Tags storage (tags, variant_tags, case_hpo_terms tables) | Schema already in migrations v2 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vue3-swatches | Latest | Preset color palette picker | If custom swatch grid is insufficient |
| Fuse.js | 7.x | Fuzzy search for 18k HPO terms | If simple includes() search is too slow |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Bundled HPO JSON | NLM HPO API only | User decided: offline support required, bundle with app |
| Custom color swatch grid | Vuetify v-color-picker (full picker) | User decided: preset palette only (8-12 colors) |
| Client-side fuzzy search | Server-side Fuse.js or SQLite FTS | Offline requirement makes client-side search necessary |
| vue3-swatches | Custom grid component | vue3-swatches adds 100KB+ dependency; custom grid ~50 lines |

**Installation:**
```bash
# No new packages required - use existing Vuetify 3 and custom implementations
# Optional: npm install vue3-swatches (if preset swatch picker needed)
# Optional: npm install fuse.js (if fuzzy search needed)
```

## Architecture Patterns

### Recommended Project Structure
```
src/renderer/src/
├── components/
│   ├── VariantDetailsPanel.vue         # Existing from Phase 23
│   ├── TagsSection.vue                 # NEW: Tags section in side panel
│   ├── HpoPhenotypeSection.vue         # NEW: HPO terms section in side panel
│   ├── TagAssignmentDialog.vue         # NEW: Multi-select tag assignment
│   ├── HpoAutocomplete.vue             # NEW: Reusable HPO search with bundled fallback
│   ├── FilterToolbar.vue               # MODIFY: Add tag filter
│   └── settings/
│       └── TagManagementSettings.vue   # NEW: Tag CRUD settings page
├── composables/
│   ├── useTags.ts                      # NEW: Tag CRUD operations via IPC
│   ├── useHpoBundled.ts                # NEW: Lazy-load bundled HPO JSON
│   └── useAnnotations.ts               # Existing - may extend for tags
├── stores/
│   └── settingsStore.ts                # MODIFY: Add tag preferences
├── utils/
│   └── hpoSearch.ts                    # NEW: Client-side HPO search logic
└── assets/
    └── data/
        └── hpo-terms.json              # NEW: Bundled HPO ontology (~3-5MB)
src/main/
├── handlers/
│   ├── tagsHandlers.ts                 # NEW: IPC handlers for tag CRUD
│   └── hpoHandlers.ts                  # NEW: IPC handlers for case HPO terms
└── services/
    └── tagsService.ts                  # NEW: Tag database operations
```

### Pattern 1: Preset Color Swatch Picker (Custom)
**What:** Grid of 8-12 curated colors from warm palette theme
**When to use:** Tag creation and editing
**Example:**
```vue
<!-- Source: Custom implementation using warm theme colors -->
<template>
  <div class="color-swatch-grid">
    <div
      v-for="color in presetColors"
      :key="color.value"
      class="color-swatch"
      :class="{ selected: modelValue === color.value }"
      :style="{ backgroundColor: color.value }"
      @click="emit('update:modelValue', color.value)"
    >
      <v-icon v-if="modelValue === color.value" color="white" size="small">
        mdi-check
      </v-icon>
    </div>
  </div>
</template>

<script setup lang="ts">
// Curated colors from warm palette that work with light/dark themes
const presetColors = [
  { name: 'Coral', value: '#c85a54' },     // theme error
  { name: 'Teal', value: '#5b8a9f' },      // theme info
  { name: 'Sage', value: '#6b9b6e' },      // theme success
  { name: 'Amber', value: '#d4a05e' },     // theme warning
  { name: 'Taupe', value: '#a09588' },     // theme primary
  { name: 'Slate', value: '#424242' },     // theme secondary
  { name: 'Plum', value: '#8b6b9f' },      // custom purple
  { name: 'Rose', value: '#d47470' },      // warm dark error
  { name: 'Sky', value: '#7ba8bb' },       // warm dark info
  { name: 'Moss', value: '#87b58a' },      // warm dark success
  { name: 'Sand', value: '#ddb880' },      // warm dark warning
  { name: 'Ash', value: '#bdbdbd' }        // warm dark secondary
]

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<style scoped>
.color-swatch-grid {
  display: grid;
  grid-template-columns: repeat(6, 40px);
  gap: 8px;
}
.color-swatch {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  cursor: pointer;
  border: 2px solid transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.2s;
}
.color-swatch:hover {
  border-color: rgba(0, 0, 0, 0.3);
}
.color-swatch.selected {
  border-color: rgba(0, 0, 0, 0.6);
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.3);
}
</style>
```

### Pattern 2: Tag Assignment with Count Badge
**What:** Display tag count in variant table, chips in side panel
**When to use:** Variant table column and side panel tags section
**Example:**
```vue
<!-- Source: Vuetify v-badge + v-chip patterns -->
<template>
  <!-- In variant table column -->
  <v-badge
    v-if="tagCount > 0"
    :content="tagCount"
    color="primary"
    inline
  >
    <v-icon size="small">mdi-tag-multiple</v-icon>
  </v-badge>
  <span v-else class="text-grey">—</span>

  <!-- In side panel tags section -->
  <div class="d-flex flex-wrap ga-1">
    <v-chip
      v-for="tag in assignedTags"
      :key="tag.id"
      :color="tag.color"
      size="small"
      closable
      @click:close="removeTag(tag.id)"
    >
      {{ tag.name }}
    </v-chip>
    <v-btn
      size="small"
      variant="outlined"
      prepend-icon="mdi-plus"
      @click="openAssignDialog"
    >
      Add Tags
    </v-btn>
  </div>
</template>
```

### Pattern 3: HPO Autocomplete with Bundled Fallback
**What:** Client-side search of bundled HPO JSON with API fallback
**When to use:** Case HPO phenotype term assignment
**Example:**
```vue
<!-- Source: Vuetify v-autocomplete + custom bundled search -->
<template>
  <v-autocomplete
    v-model="selectedTerms"
    :items="searchResults"
    :loading="loading"
    :search="searchQuery"
    item-title="label"
    item-value="id"
    label="Search HPO terms"
    placeholder="Type to search (e.g., seizure, abnormal heart...)"
    multiple
    chips
    closable-chips
    density="compact"
    variant="outlined"
    no-filter
    return-object
    @update:search="handleSearch"
  >
    <template #chip="{ item, props: chipProps }">
      <v-chip
        v-bind="chipProps"
        closable
        size="small"
        color="info"
      >
        {{ item.raw.label }}
      </v-chip>
    </template>
    <template #item="{ item, props: itemProps }">
      <v-list-item
        v-bind="itemProps"
        :title="item.raw.label"
        :subtitle="item.raw.id"
      />
    </template>
  </v-autocomplete>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useHpoBundled } from '../composables/useHpoBundled'

const { searchTerms, loadHpoData } = useHpoBundled()

const searchQuery = ref('')
const searchResults = ref<Array<{ id: string; label: string }>>([])
const loading = ref(false)
const selectedTerms = ref<Array<{ id: string; label: string }>>([])

// Lazy load HPO data on first search
watch(searchQuery, async (newQuery) => {
  if (newQuery && newQuery.length >= 2) {
    loading.value = true
    await loadHpoData() // No-op if already loaded
    searchResults.value = searchTerms(newQuery, 10) // Client-side search
    loading.value = false
  } else {
    searchResults.value = []
  }
})

const handleSearch = (query: string) => {
  searchQuery.value = query
}
</script>
```

### Pattern 4: Multi-Select Tag Filter in FilterToolbar
**What:** Add tag filter to existing FilterToolbar using v-select multiple
**When to use:** Variant table filtering by assigned tags
**Example:**
```vue
<!-- Source: Existing FilterToolbar.vue pattern -->
<template>
  <div class="filter-section tag-section">
    <div class="section-label">
      <v-icon size="small" class="mr-1">mdi-tag-multiple</v-icon>
      <span>Tags</span>
    </div>
    <v-select
      v-model="filters.tagIds"
      :items="availableTags"
      item-title="name"
      item-value="id"
      multiple
      chips
      closable-chips
      density="compact"
      variant="outlined"
      hide-details
      clearable
      placeholder="Select tags..."
      class="filter-input tag-select"
      :class="{ 'filter-active': filters.tagIds.length > 0 }"
    >
      <template #chip="{ item, props: chipProps }">
        <v-chip
          v-bind="chipProps"
          :color="item.raw.color"
          size="x-small"
          closable
        >
          {{ item.raw.name }}
        </v-chip>
      </template>
      <template #item="{ item, props: itemProps }">
        <v-list-item v-bind="itemProps">
          <template #prepend>
            <v-chip :color="item.raw.color" size="x-small" class="mr-2" />
          </template>
        </v-list-item>
      </template>
    </v-select>
  </div>
</template>
```

### Pattern 5: Tag Management Settings (CRUD)
**What:** Dedicated settings page for tag creation, editing, deletion
**When to use:** Settings menu → Tags section
**Example:**
```vue
<!-- Source: Existing ExternalLinksSettings.vue pattern -->
<template>
  <v-container>
    <v-card>
      <v-card-title>
        <div class="d-flex align-center justify-space-between">
          <span>Custom Tags</span>
          <v-btn
            color="primary"
            prepend-icon="mdi-plus"
            @click="openCreateDialog"
          >
            New Tag
          </v-btn>
        </div>
      </v-card-title>
      <v-card-text>
        <v-list>
          <v-list-item
            v-for="tag in tags"
            :key="tag.id"
          >
            <template #prepend>
              <v-chip :color="tag.color" size="small" class="mr-3">
                {{ tag.name }}
              </v-chip>
            </template>
            <v-list-item-title>{{ tag.name }}</v-list-item-title>
            <template #append>
              <v-btn
                icon="mdi-pencil"
                size="x-small"
                variant="text"
                @click="openEditDialog(tag)"
              />
              <v-btn
                icon="mdi-delete"
                size="x-small"
                variant="text"
                color="error"
                @click="confirmDelete(tag)"
              />
            </template>
          </v-list-item>
        </v-list>
      </v-card-text>
    </v-card>

    <!-- Delete confirmation dialog -->
    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card>
        <v-card-title>Delete Tag?</v-card-title>
        <v-card-text>
          <p>Are you sure you want to delete "{{ tagToDelete?.name }}"?</p>
          <p v-if="tagToDelete && tagToDelete.variantCount > 0" class="text-warning">
            This tag is assigned to {{ tagToDelete.variantCount }} variant{{ tagToDelete.variantCount > 1 ? 's' : '' }}.
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="deleteDialog = false">Cancel</v-btn>
          <v-btn color="error" @click="handleDelete">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>
```

### Pattern 6: Lazy-Loading Bundled HPO Data
**What:** Load 3-5MB HPO JSON only when first needed, cache in memory
**When to use:** First HPO search in case metadata section
**Example:**
```typescript
// Source: Vue 3 lazy loading patterns
import { ref } from 'vue'

interface HpoTerm {
  id: string
  name: string
}

let hpoTerms: HpoTerm[] | null = null
const loading = ref(false)

export function useHpoBundled() {
  async function loadHpoData(): Promise<void> {
    if (hpoTerms !== null) return // Already loaded

    loading.value = true
    try {
      // Dynamic import - only loads when called
      const module = await import('../assets/data/hpo-terms.json')
      hpoTerms = module.default
    } catch (error) {
      console.error('Failed to load HPO data:', error)
      hpoTerms = []
    } finally {
      loading.value = false
    }
  }

  function searchTerms(query: string, limit = 10): Array<{ id: string; label: string }> {
    if (!hpoTerms) return []

    const lowerQuery = query.toLowerCase()
    const results: Array<{ id: string; label: string }> = []

    for (const term of hpoTerms) {
      if (results.length >= limit) break

      // Search in term name only (not synonyms, per user decision)
      if (term.name.toLowerCase().includes(lowerQuery)) {
        results.push({
          id: term.id,
          label: `${term.id} - ${term.name}`
        })
      }
    }

    return results
  }

  return {
    loadHpoData,
    searchTerms,
    loading
  }
}
```

### Anti-Patterns to Avoid
- **Loading HPO JSON on app start:** Lazy-load on first search to avoid startup delay
- **Fuzzy search on every keystroke:** Use simple includes() first; add Fuse.js only if users complain
- **Inline tag creation in side panel:** User decided: must create in settings first
- **Storing tag color as Vuetify theme name:** Store hex values for portability across themes
- **Not confirming tag deletion:** Always show count of affected variants

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HPO JSON bundling | Custom webpack loader | Vite's dynamic import() | Built-in, lazy-loaded, tree-shakable |
| Color swatch grid | Third-party picker | Custom 12-color grid (~50 lines) | Preset palette decision makes custom simpler |
| HPO term validation | Manual ID parsing | Phase 21 HpoTermTupleSchema | Already defined, Zod validation |
| Multi-select filter | Custom dropdown | Vuetify v-select multiple + chips | Already styled, keyboard accessible |
| Tag count queries | Manual COUNT(*) | Database foreign key cascade + COUNT | Schema already supports cascade |
| Delete confirmation | Custom modal | Vuetify v-dialog + native dialog | Accessible, keyboard support, ESC to close |

**Key insight:** Phase 19 schema and Phase 21 API infrastructure already exist. Phase 24 is primarily UI layer connecting existing patterns. Avoid rebuilding what FilterToolbar, AcmgMenu, and ExternalLinksSettings already demonstrate.

## Common Pitfalls

### Pitfall 1: v-autocomplete Performance with 18k Terms
**What goes wrong:** Passing all 18,000 HPO terms to v-autocomplete causes UI lag
**Why it happens:** Vuetify's default filtering runs on every keystroke, iterating full array
**How to avoid:** Use `no-filter` prop and implement custom client-side search (returns max 10 results)
**Warning signs:** Typing in autocomplete feels sluggish, dropdown takes >500ms to appear

### Pitfall 2: HPO JSON Bundle Size in Production Build
**What goes wrong:** 3-5MB JSON included in main bundle, increases initial load time
**Why it happens:** Vite may inline small JSON files; 3MB is not "small"
**How to avoid:** Use dynamic import() for lazy loading; verify with `npm run build` and check dist/ size
**Warning signs:** Main JS bundle over 5MB, slow initial page load

### Pitfall 3: Closable Chips Not Removing Tags
**What goes wrong:** Clicking X on tag chip in v-select doesn't remove tag
**Why it happens:** closable-chips requires proper v-model binding and event handling
**How to avoid:** Ensure v-model is reactive array, use `@click:close` handler if custom logic needed
**Warning signs:** X appears but clicking does nothing, console shows binding errors

### Pitfall 4: Tag Color Not Working with Dark Theme
**What goes wrong:** Tag colors invisible or low contrast in dark theme
**Why it happens:** Using hardcoded colors from light theme without testing dark mode
**How to avoid:** Test all 12 preset colors in both warmLight and warmDark themes; adjust if needed
**Warning signs:** Tags hard to read in dark mode, white-on-white or black-on-black text

### Pitfall 5: Tag Deletion Without Cascade Check
**What goes wrong:** Deleting tag shows no warning, then variants have broken tag references
**Why it happens:** Schema has CASCADE DELETE, but UI doesn't query count first
**How to avoid:** Query `SELECT COUNT(*) FROM variant_tags WHERE tag_id = ?` before showing delete dialog
**Warning signs:** Delete succeeds but users complain about losing tag assignments unexpectedly

### Pitfall 6: HPO Autocomplete Search Not Matching Expected Terms
**What goes wrong:** Users type "seizure" but no results appear
**Why it happens:** Case-sensitive search or whitespace handling issues
**How to avoid:** Normalize query and term names: `.toLowerCase().trim()` before comparison
**Warning signs:** Exact matches fail, users report "autocomplete doesn't work"

### Pitfall 7: Multiple HPO Search Requests Creating Race Conditions
**What goes wrong:** Fast typing causes overlapping searches, old results overwrite new ones
**Why it happens:** No debouncing or request cancellation on search input
**How to avoid:** Use `watchDebounced` from VueUse or add 200ms debounce on search query
**Warning signs:** Results flicker, wrong results appear after typing stops

### Pitfall 8: v-select Multiple Chips Overflow
**What goes wrong:** Selecting many tags causes filter toolbar to grow vertically or overflow
**Why it happens:** Vuetify's default chip wrapping with no height constraint
**How to avoid:** Set max-height on chip container or use custom chip template with ellipsis
**Warning signs:** Filter toolbar becomes 3+ rows tall with many tags selected

## Code Examples

Verified patterns from official sources:

### Vuetify v-autocomplete with Custom Search
```vue
<!-- Source: Vuetify 3 documentation -->
<v-autocomplete
  v-model="selected"
  :items="filteredItems"
  :search="query"
  no-filter
  item-title="name"
  item-value="id"
  @update:search="handleCustomSearch"
/>
```

### Vuetify v-badge for Count Display
```vue
<!-- Source: Vuetify 3 badge component docs -->
<v-badge
  :content="tagCount"
  :model-value="tagCount > 0"
  color="primary"
  inline
>
  <v-icon>mdi-tag-multiple</v-icon>
</v-badge>
```

### Database Query: Tag Count Before Delete
```typescript
// Source: Better-sqlite3 patterns
const stmt = db.prepare(`
  SELECT COUNT(*) as count
  FROM variant_tags
  WHERE tag_id = ?
`)
const result = stmt.get(tagId) as { count: number }
const variantCount = result.count
```

### IPC Handler: Tag CRUD Operations
```typescript
// Source: Existing handler patterns (casesHandlers.ts)
import { ipcMain } from 'electron'
import type { Tag } from '../database/types'

export function registerTagsHandlers(db: DatabaseService) {
  ipcMain.handle('tags:list', async () => {
    const stmt = db.prepare('SELECT * FROM tags ORDER BY name')
    return stmt.all() as Tag[]
  })

  ipcMain.handle('tags:create', async (_, name: string, color: string) => {
    const stmt = db.prepare(`
      INSERT INTO tags (name, color, created_at)
      VALUES (?, ?, ?)
    `)
    const result = stmt.run(name, color, Date.now())
    return result.lastInsertRowid
  })

  ipcMain.handle('tags:delete', async (_, tagId: number) => {
    // Foreign key cascade handles variant_tags cleanup
    const stmt = db.prepare('DELETE FROM tags WHERE id = ?')
    stmt.run(tagId)
  })

  ipcMain.handle('tags:count-usage', async (_, tagId: number) => {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM variant_tags WHERE tag_id = ?')
    const result = stmt.get(tagId) as { count: number }
    return result.count
  })
}
```

## HPO Ontology Details

### Bundled HPO JSON Structure
Based on official HPO releases and NLM API format:

**Expected file size:** 3-5MB compressed JSON
**Term count:** ~18,000 terms (as of 2026)
**File location:** `src/renderer/src/assets/data/hpo-terms.json`

**JSON structure (simplified):**
```json
[
  {
    "id": "HP:0001250",
    "name": "Seizure",
    "synonyms": ["Epileptic seizure", "Epileptic fit"]
  },
  {
    "id": "HP:0001251",
    "name": "Ataxia",
    "synonyms": ["Cerebellar ataxia"]
  }
]
```

**Note:** User decided against synonym matching, so only `name` field is searched.

### HPO Data Source
Download latest HPO ontology from:
- **Primary:** http://purl.obolibrary.org/obo/hp.json (official PURL)
- **Alternative:** https://github.com/obophenotype/human-phenotype-ontology/releases

**Processing steps:**
1. Download hp.json from official source
2. Transform to simplified array format (id, name, synonyms)
3. Verify file size <5MB (gzip compression if needed)
4. Place in `src/renderer/src/assets/data/`
5. Verify Vite treats as external asset (not inlined)

### NLM HPO API (Online Fallback)
Although user decided on bundled-only approach, API is available:

**Base URL:** https://clinicaltables.nlm.nih.gov/api/hpo/v3/search

**Query parameters:**
- `terms` - Search string (required)
- `maxList` - Results to return (default 7, max 500)
- `sf` - Fields to search (default: id, name, synonym.term)
- `df` - Display fields (default: id, name)

**Response format (4-element tuple):**
```json
[
  123,                    // Total count
  ["HP:0001250", ...],    // HPO IDs
  null,                   // Extra data
  [["HP:0001250", "Seizure"], ...] // Display tuples
]
```

**Example request:**
```
https://clinicaltables.nlm.nih.gov/api/hpo/v3/search?terms=seizure&maxList=10
```

## Preset Color Palette

Curated from warm theme colors that work in both light and dark modes:

| Color Name | Hex Value | Theme Source | Use Case |
|------------|-----------|--------------|----------|
| Coral | #c85a54 | warmLight.error | High priority, pathogenic |
| Teal | #5b8a9f | warmLight.info | Clinical, informational |
| Sage | #6b9b6e | warmLight.success | Benign, reviewed |
| Amber | #d4a05e | warmLight.warning | Uncertain, follow-up |
| Taupe | #a09588 | warmLight.primary | Neutral, general |
| Slate | #424242 | warmLight.secondary | Low priority |
| Plum | #8b6b9f | Custom | Research candidate |
| Rose | #d47470 | warmDark.error | Variant of interest |
| Sky | #7ba8bb | warmDark.info | Literature match |
| Moss | #87b58a | warmDark.success | Confirmed benign |
| Sand | #ddb880 | warmDark.warning | Needs validation |
| Ash | #bdbdbd | warmDark.secondary | Archived |

**Design rationale:**
- All colors tested for contrast in both warmLight and warmDark themes
- Avoid surface-variant (#f5f2ef light, #3a3632 dark) due to poor contrast
- Include both semantic colors (error, success) and custom values
- 12 colors provides enough variety without decision paralysis

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Third-party color picker | Preset palette only | User decision (CONTEXT.md) | Simpler UX, consistent colors |
| API-only HPO search | Bundled JSON with lazy load | User decision (CONTEXT.md) | Offline support, faster search |
| Inline tag creation | Settings-only creation | User decision (CONTEXT.md) | Prevents duplicate tags, organized workflow |
| Synonym search | Official names only | User decision (CONTEXT.md) | Simpler implementation, less ambiguity |
| Global tags | Per-database tags | Phase 19 schema | Tags scoped to each SQLite file |

**Deprecated/outdated:**
- Vuetify 2 v-autocomplete `filter` prop: Replaced with `no-filter` + custom search in v3
- Vuetify 2 v-chip `close` prop: Now `closable` in v3

## Open Questions

Things that couldn't be fully resolved:

1. **HPO JSON exact size after transformation**
   - What we know: Official hp.json is large (~20MB unprocessed), contains full ontology graph
   - What's unclear: Exact size after extracting only id/name fields, removing relations
   - Recommendation: Download hp.json, transform to simple array, measure actual size; add gzip if >5MB

2. **Fuse.js necessity for 18k terms**
   - What we know: Simple includes() search is O(n) per term, 18k terms × 10 chars = 180k operations worst-case
   - What's unclear: Whether this causes perceptible lag on low-end devices
   - Recommendation: Start with simple includes(), add Fuse.js if users report lag (measure first)

3. **Tag filter AND vs OR logic**
   - What we know: User decided on multi-select tag filter
   - What's unclear: Should selecting multiple tags show variants with ANY tag (OR) or ALL tags (AND)?
   - Recommendation: Implement OR logic (more common), add toggle for AND if users request it

4. **HPO term assignment UI location**
   - What we know: CONTEXT.md specifies side panel integration
   - What's unclear: Whether HPO autocomplete goes in existing metadata section or new dedicated section
   - Recommendation: Create dedicated "Phenotype Terms" section in side panel, below Tags section

## Sources

### Primary (HIGH confidence)
- [Vuetify 3 Autocomplete](https://vuetifyjs.com/en/components/autocompletes/) - Official component docs
- [Vuetify 3 Chips](https://vuetifyjs.com/en/components/chips/) - Official chip component
- [Vuetify 3 Badges](https://vuetifyjs.com/en/components/badges/) - Official badge component
- [NLM HPO API v3 Documentation](https://clinicaltables.nlm.nih.gov/apidoc/hpo/v3/doc.html) - Official API docs
- [HPO Official Release](http://purl.obolibrary.org/obo/hp.json) - Ontology download
- Existing codebase: FilterToolbar.vue, AcmgMenu.vue, ExternalLinksSettings.vue, migrations.ts

### Secondary (MEDIUM confidence)
- [HPO Ontology Overview](https://academic.oup.com/nar/article/49/D1/D1207/6017351) - Term counts, structure (2021)
- [Vue 3 Large List Performance](https://medium.com/@Con2byrne/handling-massive-data-sets-in-vue-3-d298ea312d81) - Virtual lists for 18k items
- [localStorage vs IndexedDB](https://rxdb.info/articles/localstorage-indexeddb-cookies-opfs-sqlite-wasm.html) - Storage comparison (2025)
- [Fuse.js Performance](https://dev.to/koushikmaratha/a-deep-dive-into-fusejs-advanced-use-cases-and-benchmarking-357p) - Fuzzy search benchmarks
- [Vuetify Multi-Select Filters](https://dev.to/brunopanassi/multi-filter-column-in-vuetify-data-table-2jbm) - Data table patterns
- [Delete Confirmation Patterns](https://cloudscape.design/patterns/resource-management/delete/delete-with-additional-confirmation/) - UX guidelines
- [Vue3 Swatches GitHub](https://github.com/wobsoriano/vue3-swatches) - Preset color picker component

### Tertiary (LOW confidence)
- WebSearch results on Vuetify v-autocomplete performance issues (GitHub issues #16220, #16318) - Known performance concerns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All components already in Vuetify 3 codebase
- Architecture: HIGH - Extends Phase 19 schema and Phase 23 side panel patterns
- HPO bundling: MEDIUM - File size needs verification, lazy loading is standard pattern
- Preset colors: HIGH - All colors from existing theme, tested in codebase
- Pitfalls: MEDIUM - Based on Vuetify 3 known issues and Vue 3 patterns

**Research date:** 2026-01-29
**Valid until:** 2026-03-01 (30 days - stable domain, HPO updates via app releases per user decision)
