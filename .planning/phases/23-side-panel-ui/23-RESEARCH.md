# Phase 23: Side Panel UI - Research

**Researched:** 2026-01-29
**Domain:** Vuetify navigation drawer, resizable panels, inline editing, variant annotation display
**Confidence:** HIGH (built on existing codebase patterns + official Vuetify documentation)

## Summary

Phase 23 implements a resizable right-side panel for variant details display. The panel will show variant identity, annotation scores from the database, comments (global and per-case), ACMG classification, and external links with copy-to-clipboard functionality.

The implementation will leverage Vuetify 3's `v-navigation-drawer` component with `location="right"` and `temporary` mode. For resizing, a custom drag handle implementation is recommended over third-party libraries to minimize dependencies and maintain consistency with the existing codebase patterns. The panel will use scrollable sections (as decided in CONTEXT.md) rather than tabs or accordions.

**Primary recommendation:** Build on existing annotation infrastructure from Phase 20 (useAnnotations composable, AcmgMenu, CommentDialog) and create a dedicated VariantDetailsPanel.vue component with custom resize handle logic and threshold-based score coloring.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vuetify 3 | 3.x | v-navigation-drawer, v-chip, v-tooltip | Already in codebase, provides right-drawer support |
| Vue 3 | 3.x | Composition API, reactive state | Existing architecture |
| Pinia | 2.x | User preferences (panel width) | Already used for externalLinksStore |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @wdns/vuetify-resize-drawer | 3.3.1 | Resizable drawer extension | Alternative if custom drag handle is insufficient |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom drag handle | @wdns/vuetify-resize-drawer | Third-party adds dependency; custom keeps code simpler |
| Tabs for sections | Scrollable sections | User decision: scrollable sections preferred (CONTEXT.md) |
| vue-draggable-resizable | Custom CSS resize | Overkill for single-axis resize, adds unnecessary weight |

**Installation:**
```bash
# No new packages required - use existing Vuetify 3 and custom resize implementation
```

## Architecture Patterns

### Recommended Project Structure
```
src/renderer/src/
├── components/
│   ├── VariantDetailsPanel.vue      # Main panel component
│   ├── VariantIdentitySection.vue   # Gene, HGVS, position display
│   ├── AnnotationScoresSection.vue  # Score chips with threshold colors
│   ├── CommentsSection.vue          # Inline-editable comments
│   └── ExternalLinksSection.vue     # Link buttons + copy-to-clipboard
├── composables/
│   ├── useAnnotations.ts            # Existing - reuse
│   ├── usePanelResize.ts            # NEW: resize logic + persistence
│   └── useClipboard.ts              # NEW: copy-to-clipboard utility
├── stores/
│   └── externalLinksStore.ts        # Existing - add new link configs
└── utils/
    └── externalLinks.ts             # Existing - add new URL builders
```

### Pattern 1: Resizable Navigation Drawer with Custom Handle
**What:** Custom CSS drag handle on left edge of right drawer
**When to use:** User needs to resize panel width, preference persisted
**Example:**
```vue
<!-- Source: Custom implementation based on Vue 3 patterns -->
<template>
  <v-navigation-drawer
    v-model="isOpen"
    location="right"
    temporary
    :width="panelWidth"
    class="variant-panel"
  >
    <!-- Resize handle on left edge -->
    <div
      class="resize-handle"
      @mousedown="startResize"
    />

    <v-card flat class="h-100 d-flex flex-column">
      <!-- Panel content -->
    </v-card>
  </v-navigation-drawer>
</template>

<script setup lang="ts">
const panelWidth = ref(400)
const isResizing = ref(false)
const startX = ref(0)
const startWidth = ref(0)

const startResize = (e: MouseEvent) => {
  isResizing.value = true
  startX.value = e.clientX
  startWidth.value = panelWidth.value
  document.addEventListener('mousemove', handleResize)
  document.addEventListener('mouseup', stopResize)
}

const handleResize = (e: MouseEvent) => {
  if (!isResizing.value) return
  // For right drawer, moving left increases width
  const delta = startX.value - e.clientX
  const newWidth = Math.min(Math.max(startWidth.value + delta, 300), 800)
  panelWidth.value = newWidth
}

const stopResize = () => {
  isResizing.value = false
  document.removeEventListener('mousemove', handleResize)
  document.removeEventListener('mouseup', stopResize)
  // Persist to localStorage
  localStorage.setItem('varlens_panel_width', String(panelWidth.value))
}
</script>

<style scoped>
.resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: ew-resize;
  background: transparent;
  z-index: 10;
}
.resize-handle:hover {
  background: rgba(var(--v-theme-primary), 0.2);
}
</style>
```

### Pattern 2: Threshold-Based Score Coloring
**What:** Color-coded chips based on clinical significance thresholds
**When to use:** Displaying pathogenicity scores (CADD, REVEL, gnomAD AF, SpliceAI)
**Example:**
```typescript
// Source: Clinical literature thresholds (see Sources section)
interface ScoreThreshold {
  green: number  // Benign threshold
  orange: number // Uncertain threshold
  red: number    // Pathogenic threshold
  direction: 'high-bad' | 'low-bad' // Whether high values are concerning
}

const SCORE_THRESHOLDS: Record<string, ScoreThreshold> = {
  cadd: { green: 10, orange: 15, red: 20, direction: 'high-bad' },
  revel: { green: 0.5, orange: 0.7, red: 0.8, direction: 'high-bad' },
  spliceai: { green: 0.2, orange: 0.5, red: 0.8, direction: 'high-bad' },
  gnomad_af: { green: 0.01, orange: 0.001, red: 0.0001, direction: 'low-bad' }
}

function getScoreColor(scoreName: string, value: number | null): string {
  if (value === null) return 'grey'
  const threshold = SCORE_THRESHOLDS[scoreName]
  if (!threshold) return 'grey'

  if (threshold.direction === 'high-bad') {
    if (value >= threshold.red) return 'error'
    if (value >= threshold.orange) return 'warning'
    if (value >= threshold.green) return 'success'
    return 'grey-lighten-1'
  } else {
    // For gnomAD AF: lower is more concerning (rarer variants)
    if (value <= threshold.red) return 'error'
    if (value <= threshold.orange) return 'warning'
    if (value <= threshold.green) return 'success'
    return 'grey-lighten-1'
  }
}
```

### Pattern 3: Inline Editable Comment
**What:** Click-to-edit text with auto-save on blur
**When to use:** Comment editing in side panel (per CONTEXT.md decision)
**Example:**
```vue
<!-- Source: Vue 3 composition patterns -->
<template>
  <div class="inline-edit">
    <div
      v-if="!isEditing"
      class="comment-text"
      @click="startEdit"
    >
      {{ displayText }}
      <v-icon size="x-small" class="edit-icon">mdi-pencil</v-icon>
    </div>
    <v-textarea
      v-else
      v-model="editValue"
      ref="inputRef"
      auto-grow
      rows="2"
      variant="outlined"
      density="compact"
      hide-details
      @blur="saveEdit"
      @keydown.escape="cancelEdit"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'

const props = defineProps<{
  modelValue: string | null
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
}>()

const isEditing = ref(false)
const editValue = ref('')
const inputRef = ref<HTMLElement | null>(null)

const displayText = computed(() => props.modelValue || props.placeholder || 'Click to add comment')

const startEdit = () => {
  editValue.value = props.modelValue ?? ''
  isEditing.value = true
  nextTick(() => inputRef.value?.focus())
}

const saveEdit = () => {
  const trimmed = editValue.value.trim()
  emit('update:modelValue', trimmed || null)
  isEditing.value = false
}

const cancelEdit = () => {
  isEditing.value = false
}
</script>
```

### Pattern 4: Copy-to-Clipboard with Feedback
**What:** Clipboard API with visual feedback
**When to use:** Copy buttons for HGVS, chr:pos:ref:alt, rsID
**Example:**
```typescript
// Source: Web Clipboard API standard
export function useClipboard() {
  const copied = ref(false)
  const error = ref<string | null>(null)

  async function copy(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text)
      copied.value = true
      error.value = null
      // Reset after 2 seconds
      setTimeout(() => { copied.value = false }, 2000)
      return true
    } catch (e) {
      error.value = 'Failed to copy'
      copied.value = false
      return false
    }
  }

  return { copy, copied, error }
}
```

### Anti-Patterns to Avoid
- **Opening links directly in renderer:** Always use `window.api.shell.openExternal()` via IPC for security
- **Mutating annotation cache outside composable:** Use existing useAnnotations methods for all updates
- **Polling for variant selection:** Use event emission or v-model pattern, not interval polling
- **Inline styles for score colors:** Use CSS classes or computed Vuetify color props

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ACMG classification menu | Custom dropdown | Existing AcmgMenu component | Already handles all 5 tiers + clear option |
| Comment timestamps | Custom formatting | Existing formatTimestamp in CommentDialog | Consistent date formatting |
| External link opening | window.open() | window.api.shell.openExternal() | Security domain validation |
| Annotation caching | Local component state | useAnnotations composable | Global cache with optimistic updates |
| URL template resolution | String interpolation | resolveUrlTemplate utility | Handles encoding, required fields |
| Score color mapping | Inline conditionals | ACMG_COLORS from useAnnotations | Consistent with table display |

**Key insight:** Phase 20 already established annotation infrastructure. Phase 23 should consume these patterns, not reinvent them. The side panel is a new view onto existing data, not a new data layer.

## Common Pitfalls

### Pitfall 1: Navigation Drawer Click-Outside Behavior
**What goes wrong:** Default temporary drawer closes on any click outside, including copy button clicks that lose focus
**Why it happens:** Vuetify temporary drawer has `persistent` prop defaulting to false
**How to avoid:** Set `persistent` prop or use `:scrim="false"` if needed; implement explicit close button and Escape key (per CONTEXT.md)
**Warning signs:** Panel closing unexpectedly during interactions

### Pitfall 2: Resize Handle Conflicting with Drawer Animation
**What goes wrong:** Resize during drawer open/close animation causes visual glitches
**Why it happens:** Width changes conflict with CSS transitions
**How to avoid:** Disable transitions during resize or debounce width updates
**Warning signs:** Jerky animation, width snapping

### Pitfall 3: Stale Annotation Data After Tab Switch
**What goes wrong:** Panel shows old variant's data after navigating to Cohort Analysis and back
**Why it happens:** Panel not clearing selected variant on tab navigation
**How to avoid:** Watch for route/tab changes and close panel (per CONTEXT.md: "Closes on navigation")
**Warning signs:** Panel content doesn't match selected table row

### Pitfall 4: Copy-to-Clipboard Fails Silently in Electron
**What goes wrong:** Clipboard API fails but no error shown to user
**Why it happens:** Clipboard API requires secure context; some Electron configurations may have issues
**How to avoid:** Use try/catch with user-visible error feedback; consider IPC-based clipboard if needed
**Warning signs:** Copy button appears to work but nothing in clipboard

### Pitfall 5: Score Chips Overflow on Narrow Panel
**What goes wrong:** Score chips wrap awkwardly or overflow horizontally
**Why it happens:** Fixed chip sizes don't account for minimum panel width
**How to avoid:** Set `min-width` on resize (300px minimum); use `flex-wrap` on chip container
**Warning signs:** Horizontal scrollbar appears in score section

### Pitfall 6: Missing External Link Domains in Allowlist
**What goes wrong:** New external links (LitVar, PubTator, Decipher) fail to open
**Why it happens:** shell.ts ALLOWED_DOMAINS needs updating
**How to avoid:** Add all new domains to ALLOWED_DOMAINS array in shell.ts
**Warning signs:** "Domain not allowed" error in console

## Code Examples

Verified patterns from official sources:

### Vuetify Navigation Drawer (Right, Temporary)
```vue
<!-- Source: Vuetify 3 documentation -->
<v-navigation-drawer
  v-model="drawer"
  location="right"
  temporary
  :width="400"
>
  <template v-slot:prepend>
    <v-toolbar color="transparent" flat>
      <v-toolbar-title>Variant Details</v-toolbar-title>
      <v-btn icon @click="drawer = false">
        <v-icon>mdi-close</v-icon>
      </v-btn>
    </v-toolbar>
  </template>

  <!-- Content goes here -->
</v-navigation-drawer>
```

### Score Chip Display
```vue
<!-- Source: Vuetify v-chip + project patterns -->
<v-chip
  :color="getScoreColor('cadd', variant.cadd)"
  size="small"
  label
  class="mr-1"
>
  <span class="font-weight-medium">CADD</span>
  <span class="ml-1">{{ variant.cadd?.toFixed(1) ?? '-' }}</span>
</v-chip>
```

### External Link Button Row
```vue
<!-- Source: Existing VariantTable patterns -->
<div class="d-flex flex-wrap ga-1">
  <v-tooltip v-for="link in visibleLinks" :key="link.id" location="top">
    <template #activator="{ props }">
      <v-btn
        v-bind="props"
        icon
        size="x-small"
        variant="text"
        @click="openExternalLink(link.url)"
      >
        <v-icon>{{ link.icon }}</v-icon>
      </v-btn>
    </template>
    {{ link.name }}
  </v-tooltip>
</div>
```

### Copy Button with Feedback
```vue
<!-- Source: Common Vue pattern -->
<v-btn
  icon
  size="x-small"
  variant="text"
  @click="copyToClipboard(hgvsNotation)"
>
  <v-icon>{{ copied ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
</v-btn>
```

## External Link URLs

New external links to add (INFRA-05):

### URL Templates for externalLinksStore
```typescript
// PubTator (gene-based search)
{
  id: 'pubtator',
  name: 'PubTator',
  urlTemplate: 'https://www.ncbi.nlm.nih.gov/research/pubtator3/docsum?text={gene}',
  column: 'virtual',
  requiredFields: ['gene'],
  enabled: true,
  isBuiltIn: true
}

// LitVar (variant-based search via rsID or HGVS)
{
  id: 'litvar',
  name: 'LitVar',
  urlTemplate: 'https://www.ncbi.nlm.nih.gov/research/litvar2/docsum?text={chr}:{pos}:{ref}:{alt}',
  column: 'virtual',
  requiredFields: ['chr', 'pos', 'ref', 'alt'],
  enabled: true,
  isBuiltIn: true
}

// Decipher (gene-based search)
{
  id: 'decipher',
  name: 'DECIPHER',
  urlTemplate: 'https://www.deciphergenomics.org/gene/{gene}/overview/clinical-info',
  column: 'virtual',
  requiredFields: ['gene'],
  enabled: true,
  isBuiltIn: true
}

// ClinGen (gene-based search)
{
  id: 'clingen',
  name: 'ClinGen',
  urlTemplate: 'https://search.clinicalgenome.org/kb/genes/{gene}',
  column: 'virtual',
  requiredFields: ['gene'],
  enabled: true,
  isBuiltIn: true
}

// Ensembl (variant browser)
{
  id: 'ensembl',
  name: 'Ensembl',
  urlTemplate: 'https://grch37.ensembl.org/Homo_sapiens/Location/View?r={chr}:{pos_start}-{pos_end}',
  column: 'virtual',
  requiredFields: ['chr', 'pos'],
  enabled: true,
  isBuiltIn: true
}
```

### Domains for ALLOWED_DOMAINS (shell.ts)
```typescript
// Add to ALLOWED_DOMAINS array:
'ncbi.nlm.nih.gov',       // Already present - covers PubTator, LitVar
'deciphergenomics.org',   // NEW - DECIPHER
'clinicalgenome.org',     // NEW - ClinGen
'ensembl.org',            // NEW - Ensembl
'grch37.ensembl.org',     // NEW - Ensembl GRCh37 subdomain
```

## Score Threshold Reference

Clinical thresholds for color-coding (based on literature):

| Score | Green (Benign) | Orange (Uncertain) | Red (Pathogenic) | Notes |
|-------|----------------|-------------------|------------------|-------|
| CADD | < 10 | 10-20 | >= 20 | Median for canonical splice changes is ~15 |
| REVEL | < 0.5 | 0.5-0.75 | >= 0.75 | Author-recommended thresholds |
| SpliceAI | < 0.2 | 0.2-0.5 | >= 0.5 | 0.2=high recall, 0.5=balanced, 0.8=high precision |
| gnomAD AF | >= 0.01 | 0.001-0.01 | < 0.001 | Inverse: lower frequency = more concerning |

**Important:** These are display thresholds only. Clinical interpretation requires expert review. Scores alone do not determine pathogenicity.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tabs for variant details | Scrollable sections | User decision (CONTEXT.md) | Simpler navigation |
| Modal dialog for comments | Inline editing in panel | User decision (CONTEXT.md) | Faster editing workflow |
| Global ACMG/stars | Per-case ACMG/stars (Phase 20) | v0.4.0 | Different classification per case |

**Deprecated/outdated:**
- v-navigation-drawer `mini-variant` prop: Replaced with `rail` in Vuetify 3

## Open Questions

Things that couldn't be fully resolved:

1. **VEP enrichment display**
   - What we know: Phase 21 will provide VEP API client
   - What's unclear: Exact response structure, which fields to display
   - Recommendation: Design VEP section with loading skeleton; finalize display when Phase 21 completes

2. **LitVar exact URL format for coordinate search**
   - What we know: LitVar supports multiple query formats (rsID, HGVS, coordinates)
   - What's unclear: Best URL format for chr:pos:ref:alt queries
   - Recommendation: Start with `text=` parameter; validate after implementation

3. **rsID availability in variant data**
   - What we know: PANEL-06 requires rsID copy button
   - What's unclear: Whether rsID is in current Variant interface
   - Recommendation: Check if rsID exists in imported VEP data; if not, show "N/A" for rsID field

## Sources

### Primary (HIGH confidence)
- Vuetify 3 Navigation Drawer: https://vuetifyjs.com/en/components/navigation-drawers/
- Vuetify 3 Chips: https://vuetifyjs.com/en/components/chips/
- Existing codebase: useAnnotations.ts, AcmgMenu.vue, CommentDialog.vue, externalLinksStore.ts

### Secondary (MEDIUM confidence)
- CADD score thresholds: https://cadd.gs.washington.edu/info
- REVEL thresholds: https://pmc.ncbi.nlm.nih.gov/articles/PMC5065685/
- SpliceAI thresholds: https://github.com/Illumina/SpliceAI
- gnomAD AF filtering: https://pmc.ncbi.nlm.nih.gov/articles/PMC9160216/
- LitVar API: https://www.ncbi.nlm.nih.gov/CBBresearch/Lu/Demo/LitVar/api.html
- PubTator 3.0: https://www.ncbi.nlm.nih.gov/research/pubtator3/
- DECIPHER: https://www.deciphergenomics.org/

### Tertiary (LOW confidence)
- vuetify-resize-drawer: https://github.com/webdevnerdstuff/vuetify-resize-drawer (alternative if custom resize fails)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Uses existing Vuetify 3 + codebase patterns
- Architecture: HIGH - Extends established Phase 20 patterns
- Pitfalls: MEDIUM - Based on common Vue/Vuetify issues and project experience
- Score thresholds: MEDIUM - Literature-based but not universally agreed

**Research date:** 2026-01-29
**Valid until:** 2026-02-28 (30 days - stable domain)
