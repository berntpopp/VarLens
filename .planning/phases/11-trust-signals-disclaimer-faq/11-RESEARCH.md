# Phase 11: Trust Signals -- Disclaimer & FAQ - Research

**Researched:** 2026-01-27
**Domain:** User onboarding, trust signals, genomic research tool disclaimers
**Confidence:** HIGH

## Summary

This phase implements first-launch disclaimer dialogs and FAQ access using Vuetify 3 dialog components in a Vue 3 Composition API application. The technical implementation is straightforward with well-established patterns for modal dialogs, localStorage version tracking, keyboard shortcuts, and searchable expansion panels. The project already has necessary infrastructure (Vuetify 3.11.7, warm theme palette, useDebounce composable).

The unique challenge lies in content standards for genomic research tool disclaimers. Research reveals that established tools (ClinVar, UCSC Genome Browser, gnomAD, Ensembl VEP) consistently emphasize research-only use, require independent verification, and explicitly warn against clinical decision-making without professional review. ACMG guidelines recommend "appropriate disclaimers" addressing laboratory testing limitations.

**Primary recommendation:** Use Vuetify 3's v-dialog with `persistent` prop for blocking disclaimer, v-expansion-panels with `multiple` prop for FAQ, VueUse's `onKeyStroke` for keyboard shortcuts, and localStorage for version-gated acknowledgment. Model disclaimer language on established genomic databases (ClinVar, UCSC) with firm-but-friendly tone.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vuetify 3 | 3.11.7 | Dialog, expansion panels, UI components | Already integrated, Material Design 3 components, excellent accessibility |
| VueUse | Latest | `onKeyStroke` composable for keyboard shortcuts | Official Vue ecosystem utilities, handles cleanup automatically |
| localStorage | Native | Version-gated acknowledgment persistence | Native Web API, synchronous, persists across sessions in Electron renderer |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| JSON config files | N/A | Disclaimer and FAQ content storage | Configurable content per TRST-08, TRST-09 requirements |
| useDebounce | Local | Search input debouncing | Already exists in project at `src/renderer/src/composables/useDebounce.ts` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| VueUse onKeyStroke | Manual addEventListener | VueUse handles cleanup, more maintainable, but adds dependency |
| localStorage | Electron store | localStorage simpler for renderer-only data, Electron store for main process sharing |
| JSON files | Hardcoded content | JSON allows runtime config changes, hardcoding is simpler but inflexible |

**Installation:**
```bash
npm install @vueuse/core
```

## Architecture Patterns

### Recommended Project Structure
```
src/renderer/src/
├── components/
│   ├── DisclaimerDialog.vue     # Blocking first-launch disclaimer
│   ├── FaqDialog.vue             # Searchable FAQ with expansion panels
│   └── icons/                    # Already exists (DnaIcon.vue)
├── composables/
│   ├── useDebounce.ts            # Already exists - use for search
│   ├── useKeyboardShortcuts.ts   # New - global keyboard shortcuts
│   └── useVersionGating.ts       # New - version acknowledgment logic
├── config/
│   ├── disclaimerConfig.json     # Disclaimer text configuration
│   └── faqConfig.json            # FAQ content configuration
└── App.vue                       # Mount disclaimer on startup, register shortcuts
```

### Pattern 1: Blocking Modal Dialog with Version Gating

**What:** First-launch disclaimer that blocks app access until acknowledged, re-shown on version changes.

**When to use:** User onboarding, legal requirements, critical information that must be acknowledged.

**Example:**
```vue
<!-- DisclaimerDialog.vue -->
<template>
  <v-dialog
    v-model="isOpen"
    :persistent="true"
    max-width="600"
    :scrim="true"
  >
    <v-card>
      <v-card-title>Research Use Only</v-card-title>
      <v-card-text>
        <p>{{ disclaimerText.introduction }}</p>
        <v-list density="compact">
          <v-list-item
            v-for="(limitation, i) in disclaimerText.limitations"
            :key="i"
          >
            <template #prepend>
              <v-icon :icon="limitation.icon" size="small" />
            </template>
            <v-list-item-title>{{ limitation.text }}</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn color="primary" @click="handleAcknowledge">
          I Understand — Continue
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useVersionGating } from '../composables/useVersionGating'
import disclaimerConfig from '../config/disclaimerConfig.json'

const isOpen = ref(false)
const disclaimerText = disclaimerConfig
const { checkAcknowledgment, recordAcknowledgment } = useVersionGating()

onMounted(() => {
  // Check if current version has been acknowledged
  if (!checkAcknowledgment()) {
    isOpen.value = true
  }
})

const handleAcknowledge = () => {
  recordAcknowledgment()
  isOpen.value = false
}

defineExpose({ show: () => { isOpen.value = true } })
</script>
```

### Pattern 2: Version Gating with SemVer

**What:** localStorage-based acknowledgment tracking that triggers on any version change.

**When to use:** App updates, terms of service changes, feature announcements.

**Example:**
```typescript
// useVersionGating.ts
import { ref } from 'vue'

const STORAGE_KEY = 'varlens_disclaimer_version'

export function useVersionGating() {
  // Get version from package.json at build time
  const currentVersion = ref(__APP_VERSION__) // Injected via Vite define

  const checkAcknowledgment = (): boolean => {
    const acknowledgedVersion = localStorage.getItem(STORAGE_KEY)
    return acknowledgedVersion === currentVersion.value
  }

  const recordAcknowledgment = (): void => {
    localStorage.setItem(STORAGE_KEY, currentVersion.value)
  }

  const clearAcknowledgment = (): void => {
    localStorage.removeItem(STORAGE_KEY)
  }

  return {
    currentVersion,
    checkAcknowledgment,
    recordAcknowledgment,
    clearAcknowledgment
  }
}
```

### Pattern 3: Global Keyboard Shortcuts with VueUse

**What:** Application-wide keyboard shortcuts that work regardless of focus, registered at app level.

**When to use:** Power-user features, accessibility shortcuts, dev-only access.

**Example:**
```typescript
// useKeyboardShortcuts.ts
import { onKeyStroke } from '@vueuse/core'

export function useKeyboardShortcuts(callbacks: {
  onDisclaimerShortcut?: () => void
  onFaqShortcut?: () => void
}) {
  // Ctrl+Shift+D for disclaimer
  const stopDisclaimer = onKeyStroke(
    (e) => e.key === 'D' && e.ctrlKey && e.shiftKey,
    (e) => {
      e.preventDefault()
      callbacks.onDisclaimerShortcut?.()
    }
  )

  // Ctrl+Shift+Q for FAQ
  const stopFaq = onKeyStroke(
    (e) => e.key === 'Q' && e.ctrlKey && e.shiftKey,
    (e) => {
      e.preventDefault()
      callbacks.onFaqShortcut?.()
    }
  )

  // Return cleanup function
  return () => {
    stopDisclaimer()
    stopFaq()
  }
}
```

### Pattern 4: Searchable Expansion Panels

**What:** FAQ content organized in expansion panels with live search filtering.

**When to use:** Large Q&A content, documentation, help systems.

**Example:**
```vue
<!-- FaqDialog.vue -->
<template>
  <v-dialog v-model="isOpen" max-width="600" scrollable>
    <v-card>
      <v-card-title>Frequently Asked Questions</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="searchQuery"
          label="Search questions..."
          prepend-inner-icon="mdi-magnify"
          clearable
          variant="outlined"
          density="compact"
          class="mb-4"
        />

        <v-expansion-panels v-if="filteredFaq.length > 0" :multiple="true">
          <v-expansion-panel
            v-for="(item, i) in filteredFaq"
            :key="i"
          >
            <v-expansion-panel-title>
              {{ item.question }}
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              {{ item.answer }}
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>

        <v-alert v-else type="info" variant="tonal">
          No matching questions found. Try rephrasing your search.
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="isOpen = false">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useDebounce } from '../composables/useDebounce'
import faqConfig from '../config/faqConfig.json'

const isOpen = ref(false)
const searchQuery = ref('')
const faqItems = faqConfig.items

// Debounced search with existing composable
const { debouncedFn: debouncedSearch } = useDebounce(
  (query: string) => {
    searchQuery.value = query
  },
  400 // 400ms delay
)

const filteredFaq = computed(() => {
  if (!searchQuery.value) return faqItems

  const query = searchQuery.value.toLowerCase()
  return faqItems.filter(item =>
    item.question.toLowerCase().includes(query) ||
    item.answer.toLowerCase().includes(query) ||
    item.category?.toLowerCase().includes(query)
  )
})

defineExpose({ show: () => { isOpen.value = true } })
</script>
```

### Pattern 5: JSON Configuration for Content

**What:** Structured JSON files storing disclaimer and FAQ content separately from code.

**When to use:** Configurable content, easy updates without code changes, potential i18n future.

**Example:**
```json
// disclaimerConfig.json
{
  "introduction": "Varlens is a research analysis tool for genomic variant data. It is not validated for clinical diagnostic use.",
  "limitations": [
    {
      "icon": "mdi-flask-outline",
      "text": "Not for diagnostic use — results must not be used for medical decision-making"
    },
    {
      "icon": "mdi-shield-check-outline",
      "text": "Verification required — all findings must be independently validated"
    },
    {
      "icon": "mdi-account-heart-outline",
      "text": "No clinical relationship — this tool does not establish a doctor-patient relationship"
    }
  ],
  "footer": "By continuing, you acknowledge these limitations and agree to use Varlens for research purposes only."
}

// faqConfig.json
{
  "items": [
    {
      "category": "General",
      "question": "What is Varlens designed for?",
      "answer": "Varlens is designed for offline analysis of genomic variant data in research settings. It provides filtering, classification, and export capabilities for VCF data."
    },
    {
      "category": "Data",
      "question": "What data formats are supported?",
      "answer": "Varlens supports VCF files in JSON format (from VEP annotation). Files can be gzipped."
    }
  ]
}
```

### Anti-Patterns to Avoid

- **Dismissible blocking dialogs:** Using `persistent="false"` or allowing escape/overlay clicks defeats the purpose of acknowledgment requirements. The disclaimer MUST be blocking.
- **Accordion mode for FAQ:** Using accordion (only one panel open) frustrates users comparing answers. Use `multiple` prop to allow simultaneous panels.
- **Version hash instead of semver:** Storing git hashes or timestamps instead of package.json version creates maintenance burden and breaks semantic expectations.
- **Inline content in components:** Hardcoding disclaimer/FAQ text in Vue components prevents easy content updates and breaks TRST-08/TRST-09 requirements.
- **Global keyboard shortcuts without preventDefault:** Failing to prevent default browser behavior (Ctrl+D bookmarks, Ctrl+Q quits) causes conflicts.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Debounced search input | Custom setTimeout management | Existing `useDebounce` composable | Project already has it at `src/renderer/src/composables/useDebounce.ts`, handles cleanup |
| Keyboard event listeners | Manual addEventListener with cleanup | VueUse `onKeyStroke` | Automatic cleanup, better TypeScript types, handles edge cases |
| Version comparison | String manipulation for semver | Store exact version string | Simple equality check sufficient - any version change triggers re-acknowledgment |
| Search highlighting | Custom text match highlighting | Simple filter without highlighting | Complexity not worth it for FAQ - clear filtering is sufficient |
| Modal focus trap | Custom focus management | Vuetify dialog accessibility | Vuetify handles ARIA, focus trap, ESC key automatically |

**Key insight:** Vue 3 + Vuetify 3 ecosystem is mature. Almost everything needed already exists in the stack or project. Custom solutions add maintenance burden without benefit.

## Common Pitfalls

### Pitfall 1: persistent + hide-overlay Conflict
**What goes wrong:** Setting both `persistent="true"` and `hide-overlay="true"` on v-dialog causes unexpected behavior where dialog still dismisses on outside clicks (legacy bug from Vuetify 2).

**Why it happens:** The `hide-overlay` prop removes the scrim, which the `persistent` logic depends on for click detection.

**How to avoid:** Always use the scrim (overlay) with persistent dialogs. Set `persistent="true"` and `scrim="true"` (or omit scrim as true is default).

**Warning signs:**
- Disclaimer can be dismissed by clicking outside despite `persistent` prop
- No visible overlay behind modal
- Console warnings about prop combinations

### Pitfall 2: localStorage Unavailable Before Renderer Mounts
**What goes wrong:** Attempting to check localStorage in module-level code (outside components) throws errors because localStorage is only available after renderer process initializes.

**Why it happens:** Electron's renderer context hasn't initialized yet during module import phase.

**How to avoid:** Only access localStorage inside component lifecycle hooks (`onMounted`, `setup` function body) or composable functions called from components. Never at module level.

**Warning signs:**
- "localStorage is not defined" errors
- Version check runs before app mounts
- Disclaimer doesn't show on first launch

### Pitfall 3: Keyboard Shortcut Browser Conflicts
**What goes wrong:** Ctrl+D bookmarks page, Ctrl+Q quits browser/app, Ctrl+W closes tab - your shortcuts never fire.

**Why it happens:** Browser/system shortcuts take precedence unless explicitly prevented.

**How to avoid:** Always call `e.preventDefault()` in keyboard shortcut handlers. Test on all platforms (Ctrl vs Cmd on Mac).

**Warning signs:**
- Shortcut triggers browser action instead of app action
- Works in dev, fails in production Electron build
- Mac users report shortcuts don't work (forgot to handle metaKey)

### Pitfall 4: Version Check Only on Component Mount
**What goes wrong:** If disclaimer dialog is a standalone component that only checks version when it mounts, but it's conditionally rendered or lazy-loaded, the check may never run.

**Why it happens:** Component isn't mounted at app startup, so version check never executes.

**How to avoid:** Run version check in App.vue `onMounted` (root component), not in dialog component itself. Pass result as prop to dialog or use exposed methods.

**Warning signs:**
- First launch works, but version updates don't trigger re-acknowledgment
- Disclaimer shows randomly depending on navigation path
- Version check works in dev (eager loading) but not production (code-splitting)

### Pitfall 5: Search Debounce Without Cleanup
**What goes wrong:** User types in FAQ search, navigates away before debounce fires, then timer callback tries to update unmounted component state causing errors.

**Why it happens:** setTimeout continues after component unmounts if not cleaned up.

**How to avoid:** Use `useDebounce` composable which automatically cleans up on `onBeforeUnmount`. The project already has this at `src/renderer/src/composables/useDebounce.ts`.

**Warning signs:**
- Console warnings about updating unmounted component
- Memory leaks in long-running sessions
- Errors after navigating away from FAQ

### Pitfall 6: Expansion Panels Not Actually Multiple
**What goes wrong:** Setting v-model to a single number instead of array with `multiple` prop causes only one panel to open at a time.

**Why it happens:** The `multiple` prop changes v-model type from `number` to `number[]`. Using wrong type silently falls back to accordion mode.

**How to avoid:** With `multiple` prop, always use array for v-model: `v-model="openPanels"` where `openPanels = ref<number[]>([])`. Or omit v-model entirely to allow free opening/closing.

**Warning signs:**
- FAQ panels close when opening another (accordion behavior)
- Console warnings about type mismatch
- User feedback that they can't compare multiple answers

## Code Examples

Verified patterns from official sources:

### Vuetify 3 Persistent Dialog
```vue
<!-- Source: Vuetify 3 documentation -->
<v-dialog
  v-model="dialog"
  persistent
  max-width="600px"
>
  <v-card>
    <v-card-title>Title</v-card-title>
    <v-card-text>Content that cannot be dismissed</v-card-text>
    <v-card-actions>
      <v-btn @click="dialog = false">Close</v-btn>
    </v-card-actions>
  </v-card>
</v-dialog>
```
**Key:** `persistent` prop prevents dismissal on overlay click or ESC key. User must interact with dialog buttons.

### VueUse onKeyStroke with Modifiers
```typescript
// Source: VueUse documentation
import { onKeyStroke } from '@vueuse/core'

onKeyStroke(
  (e) => e.key === 'D' && e.ctrlKey && e.shiftKey,
  (e) => {
    e.preventDefault()
    console.log('Ctrl+Shift+D pressed')
  }
)
```
**Key:** Custom predicate function for complex key combinations. Check `ctrlKey`, `shiftKey`, `altKey`, `metaKey` properties. Always preventDefault for app shortcuts.

### Vuetify 3 Expansion Panels with Multiple
```vue
<!-- Source: Vuetify 3 expansion-panels documentation -->
<v-expansion-panels multiple>
  <v-expansion-panel
    v-for="item in items"
    :key="item.id"
  >
    <v-expansion-panel-title>
      {{ item.title }}
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      {{ item.content }}
    </v-expansion-panel-text>
  </v-expansion-panel>
</v-expansion-panels>
```
**Key:** `multiple` prop allows multiple panels open simultaneously. Omit v-model for uncontrolled behavior (user freely opens/closes).

### localStorage Version Check Pattern
```typescript
// Pattern established by research, not from single source
const STORAGE_KEY = 'app_acknowledged_version'
const currentVersion = '0.2.0' // from package.json

function checkAcknowledgment(): boolean {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === currentVersion
}

function recordAcknowledgment(): void {
  localStorage.setItem(STORAGE_KEY, currentVersion)
}

// On app mount
if (!checkAcknowledgment()) {
  showDisclaimer()
}
```
**Key:** Simple string equality check. Any version change (0.2.0 → 0.2.1) triggers re-acknowledgment. No complex semver parsing needed.

## Disclaimer Content Standards

Research into genomic tool disclaimers reveals consistent patterns:

### ClinVar Disclaimer Example
> "The information on this website is not intended for direct diagnostic use or medical decision-making without review by a genetics professional. Individuals should not change their health behavior solely on the basis of information contained on this website."

**Source:** [ClinVar](https://www.ncbi.nlm.nih.gov/clinvar/) - HIGH confidence, official NCBI resource

### UCSC Genome Browser Disclaimer Example
> "Conclusions drawn from data containing phenotype and disease association tracks should be made with care, as these datasets are intended for use primarily by medical scientists and other professionals concerned with genetic disorders, by genetics researchers, and by advanced students in science and medicine, and should not be used for casual diagnosis of a medical or genetic condition."

**Source:** [UCSC Genome Browser](https://genome.ucsc.edu/) - HIGH confidence, established genomic resource

### gnomAD Terms
gnomAD releases data "for the benefit of the wider scientific community without restriction on use" but emphasizes:
> "Presence of artifacts is inevitable in any reference database and careful review of individual variants is important."

**Source:** [gnomAD Terms](http://gnomad-sg.org/terms) - HIGH confidence, Broad Institute

### Ensembl VEP FAQ
VEP states clearly:
> "For any questions not covered in the FAQ, users can send an email to the Ensembl developer's mailing list (public) or contact the Ensembl Helpdesk (private)."

And notes limitations:
> "Many variants will likely produce an empty ClinVar field because ClinVar pathogenicity assertions are only available for a small number of variants."

**Source:** [Ensembl VEP FAQ](http://www.ensembl.org/info/docs/tools/vep/vep_faq.html) - HIGH confidence, EMBL-EBI official tool

### ACMG Guidelines on Disclaimers
ACMG recommends clinical reports include "appropriate disclaimers" that address:
- General pitfalls in laboratory testing
- Sample quality and sample mix-up
- Technical limitations

**Source:** [ACMG Standards and Guidelines](https://pmc.ncbi.nlm.nih.gov/articles/PMC4544753/) - HIGH confidence, professional standards

### Recommended Disclaimer Elements for Varlens

Based on research, Varlens disclaimer should include:

1. **Research Use Only Statement** - Clear, upfront statement that tool is not for clinical diagnosis
2. **Verification Required** - Results must be independently validated
3. **No Medical Relationship** - Tool does not establish doctor-patient relationship
4. **Data Limitations** - Acknowledge potential for artifacts, incomplete data, annotation errors
5. **Professional Expertise Required** - Interpretation requires genomics/genetics expertise

**Tone:** Firm but friendly (not legalese). Similar to UCSC's "should be made with care" rather than aggressive ALL CAPS warnings.

### Recommended FAQ Topics

Based on common questions in genomic tool documentation:

**General:**
- What is Varlens designed for?
- Who should use this tool?
- What are the system requirements?

**Data:**
- What file formats are supported?
- How is data stored? (offline, local database)
- Can I export my filtered results?

**Interpretation:**
- How are pathogenicity classifications determined?
- What annotation sources are used?
- Why might results differ from other tools?

**Limitations:**
- What are the known limitations?
- When should I NOT use Varlens?
- What should I do if I find an error?

**Privacy & Security:**
- Is my data shared with anyone?
- How is data secured?
- What happens to data when I close the app?

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Vuetify 2 v-expansion-panel-header/content | Vuetify 3 v-expansion-panel-title/text | Vuetify 3.0 (2022) | Simpler API, consistent naming |
| Vue 2 Options API with mounted/beforeDestroy | Vue 3 Composition API with onMounted/onBeforeUnmount | Vue 3.0 (2020) | Better TypeScript, composable patterns |
| Manual keyboard event listeners | VueUse onKeyStroke composable | VueUse stable (2021) | Cleaner code, automatic cleanup |
| keyCode property for key detection | KeyboardEvent.key string comparison | Web standard (2017) | More intuitive, no magic numbers |

**Deprecated/outdated:**
- **Vuetify 2 expansion panel slots:** Old slot names (`v-expansion-panel-header`, `v-expansion-panel-content`) replaced with simpler `v-expansion-panel-title` and `v-expansion-panel-text` components in Vuetify 3
- **keyCode modifiers:** Vue 3 removed support for keyCode modifiers (e.g., `@keyup.13`). Use key names instead: `@keyup.enter`
- **$root event bus:** Vue 3 removed global event bus pattern. Use props/emit, provide/inject, or state management for component communication

## Open Questions

Things that couldn't be fully resolved:

1. **Mac keyboard shortcut equivalents**
   - What we know: Mac uses Cmd instead of Ctrl for most shortcuts
   - What's unclear: Should we check `e.metaKey || e.ctrlKey` to support both, or use different shortcuts on Mac?
   - Recommendation: Check both - `(e.ctrlKey || e.metaKey) && e.shiftKey` - standard cross-platform pattern. Mentioned in user context that shortcuts are dev-only, so platform differences acceptable.

2. **Exact icon choices for limitation items**
   - What we know: MDI icons available, need small visual markers for disclaimer list items
   - What's unclear: Which specific icons best represent "research only", "verification required", "no medical relationship"
   - Recommendation: Phase context suggests `mdi-flask-outline`, `mdi-shield-check-outline`, `mdi-account-heart-outline` as starting point. Marked as Claude's discretion - can be refined during implementation.

3. **FAQ initial content scope**
   - What we know: Common FAQ topics identified from research, faqConfig.json structure defined
   - What's unclear: How many initial FAQ items is right? Too few looks sparse, too many is overwhelming
   - Recommendation: Start with 8-10 items covering the recommended topics (General, Data, Interpretation, Limitations, Privacy). Can expand based on actual user questions.

## Sources

### Primary (HIGH confidence)
- [VueUse onKeyStroke Documentation](https://vueuse.org/core/onkeystroke/) - Official VueUse composable API
- [ClinVar](https://www.ncbi.nlm.nih.gov/clinvar/) - NCBI official resource for variant interpretation
- [UCSC Genome Browser](https://genome.ucsc.edu/) - Established genomic data browser with research disclaimers
- [gnomAD Terms](http://gnomad-sg.org/terms) - Broad Institute gnomAD data usage terms
- [Ensembl VEP FAQ](http://www.ensembl.org/info/docs/tools/vep/vep_faq.html) - EMBL-EBI Variant Effect Predictor documentation
- [ACMG Standards for Sequence Variant Interpretation](https://pmc.ncbi.nlm.nih.gov/articles/PMC4544753/) - Professional standards with disclaimer guidance
- [Vuetify 3 Dialog Component Documentation](https://vuetifyjs.com/en/components/dialogs/) - Official Vuetify 3 docs
- [Vuetify 3 Expansion Panels Documentation](https://vuetifyjs.com/en/components/expansion-panels/) - Official Vuetify 3 docs
- Existing codebase:
  - `/home/bernt-popp/development/varlens/src/renderer/src/composables/useDebounce.ts` - Project already has debounce composable
  - `/home/bernt-popp/development/varlens/src/renderer/src/plugins/vuetify.ts` - Vuetify 3.11.7 configuration with warm theme
  - `/home/bernt-popp/development/varlens/src/renderer/src/components/ImportDialog.vue` - Existing dialog pattern to follow

### Secondary (MEDIUM confidence)
- [Modal UX Design Best Practices 2026](https://userpilot.com/blog/modal-ux-design/) - Web search verified patterns for blocking modals
- [Vue 3 Debounce Search Patterns](https://theroadtoenterprise.com/blog/how-to-create-a-debounced-ref-in-vue-3-using-composition-api) - Community pattern for debounced input
- [Vuetify 3 FAQ Accordion Tutorial](https://webvees.com/post/how-to-use-faq-accordion-in-vuetify-3-vue-3/) - Implementation example
- [Vuetify GitHub expansion-panels.md](https://github.com/vuetifyjs/vuetify/blob/45428557d282c1d6578f661ed6e7f8a1b01a9dac/packages/docs/src/pages/en/components/expansion-panels.md) - Source documentation
- [SemVer Specification](https://semver.org/) - Semantic versioning standard
- [WHO Genomic Data Principles 2024](https://www.who.int/news/item/20-11-2024-who-releases-new-principles-for-ethical-human-genomic-data-collection-and-sharing) - Recent ethical guidance

### Tertiary (LOW confidence)
- Web search results on phentrieve/RequiForm reference projects - could not locate these specific projects, may be private repos or misspelled names. Pattern research proceeded from established tools instead.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Vuetify 3 and VueUse are well-documented, project already integrated
- Architecture: HIGH - Patterns verified in existing codebase and official documentation
- Disclaimer content: HIGH - Multiple authoritative sources (ClinVar, UCSC, gnomAD, ACMG) show consistent standards
- Pitfalls: MEDIUM - Based on GitHub issues and community patterns, not all verified in Vuetify 3.11 specifically

**Research date:** 2026-01-27
**Valid until:** ~60 days (2026-03-27) - Stable technologies, Vuetify 3 and VueUse APIs unlikely to change significantly. Disclaimer content standards are established and slow-moving. Re-validate if Vuetify 4 is announced or ACMG updates guidelines.
