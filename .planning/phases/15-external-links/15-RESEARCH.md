# Phase 15: External Links - Research

**Researched:** 2026-01-27
**Domain:** External database integration via clickable variant data with security-validated shell.openExternal
**Confidence:** MEDIUM

## Summary

Phase 15 adds clickable external database links directly within variant table data cells (not separate icon columns). The data values themselves become links: position links to gnomAD and UCSC, ClinVar ID links to ClinVar, OMIM MIM number links to OMIM entry, and variant components link to VarSome and Franklin. This requires URL builders with proper encoding, Vuetify v-data-table slot customization for clickable cells, visual link indicators (external link icon suffix, hover underline), cell click feedback (brief highlight), and domain allowlist expansion in the existing shell.openExternal security layer.

The current codebase already has a working shell.openExternal IPC pattern with HTTPS-only and domain allowlist validation (shell.ts). The variant table uses v-data-table-server with item slot customization (VariantTable.vue has examples for formatting cells). URL construction requires handling missing data gracefully (dash placeholder when link target unavailable), detecting genome build for database-specific URLs (GRCh37 → gnomAD v2, GRCh38 → gnomAD v4), and proper URL encoding of variant components (chr, pos, ref, alt).

**Primary recommendation:** Create URL builder utility functions (one per database) that handle missing data, genome build detection, and encoding. Use Vuetify item slot pattern with wrapper elements (clickable spans/divs) styled with external link icon suffix and hover underline. Expand shell.ts ALLOWED_DOMAINS array to include the six new domains. No IPC changes needed—existing shell:openExternal handles all link opening.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Electron shell.openExternal | 40.x | Opens URLs in default browser | Built-in Electron API, secure when validated |
| Vuetify v-data-table-server slots | 3.x | Custom cell rendering | Already used in VariantTable.vue, native pattern |
| Built-in encodeURIComponent | ES standard | URL encoding | Native JavaScript, zero dependencies |
| CSS :hover pseudo-class | Standard | Hover underline | Native CSS, zero JavaScript |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vuetify icons (mdi) | 3.x | External link icon suffix | For ↗ icon after clickable text |
| CSS transitions | Standard | Click highlight animation | For brief visual feedback on click |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Item slots | Right-click context menu | User requested no context menu, just click |
| Separate icon column | Inline clickable values | More columns clutter the table, user prefers data-as-link |
| v-btn for links | Styled span/div | Buttons look like actions, not data |

**Installation:**
No new dependencies needed—all features use existing libraries.

## Architecture Patterns

### Recommended Project Structure
```
src/renderer/src/
├── utils/
│   └── externalLinks.ts      # URL builder functions
├── components/
│   └── VariantTable.vue       # Add clickable cell slots
src/main/ipc/handlers/
└── shell.ts                   # Expand ALLOWED_DOMAINS
```

### Pattern 1: URL Builder Functions
**What:** Pure functions that construct external database URLs from variant data
**When to use:** For each external database (gnomAD, ClinVar, OMIM, UCSC, VarSome, Franklin)
**Example:**
```typescript
// src/renderer/src/utils/externalLinks.ts

/** Build gnomAD variant URL (v2 for GRCh37, v4 for GRCh38) */
export function buildGnomadUrl(chr: string, pos: number, ref: string, alt: string, build: 'GRCh37' | 'GRCh38'): string | null {
  if (!chr || !pos || !ref || !alt) return null

  const dataset = build === 'GRCh37' ? 'gnomad_r2_1' : 'gnomad_r4'
  const variantId = `${chr}-${pos}-${encodeURIComponent(ref)}-${encodeURIComponent(alt)}`

  return `https://gnomad.broadinstitute.org/variant/${variantId}?dataset=${dataset}`
}

/** Build ClinVar variation URL using ClinVar ID */
export function buildClinvarUrl(clinvarId: string | null): string | null {
  if (!clinvarId) return null
  return `https://www.ncbi.nlm.nih.gov/clinvar/variation/${encodeURIComponent(clinvarId)}/`
}

/** Build OMIM entry URL using MIM number */
export function buildOmimUrl(mimNumber: string | null): string | null {
  if (!mimNumber) return null
  return `https://omim.org/entry/${encodeURIComponent(mimNumber)}`
}

/** Build UCSC Genome Browser region URL (±25bp window) */
export function buildUcscUrl(chr: string, pos: number, build: 'GRCh37' | 'GRCh38'): string | null {
  if (!chr || !pos) return null

  const db = build === 'GRCh37' ? 'hg19' : 'hg38'
  const start = pos - 25
  const end = pos + 25

  return `https://genome.ucsc.edu/cgi-bin/hgTracks?db=${db}&position=${encodeURIComponent(chr)}:${start}-${end}`
}

/** Build VarSome variant URL */
export function buildVarsomeUrl(chr: string, pos: number, ref: string, alt: string, build: 'GRCh37' | 'GRCh38'): string | null {
  if (!chr || !pos || !ref || !alt) return null

  const genome = build === 'GRCh37' ? 'hg19' : 'hg38'
  const variant = `${chr}:${pos}:${encodeURIComponent(ref)}:${encodeURIComponent(alt)}`

  return `https://varsome.com/variant/${genome}/${variant}`
}

/** Build Franklin variant URL */
export function buildFranklinUrl(chr: string, pos: number, ref: string, alt: string, build: 'GRCh37' | 'GRCh38'): string | null {
  if (!chr || !pos || !ref || !alt) return null

  // Franklin uses HG19/HG38 format (uppercase)
  const genome = build === 'GRCh37' ? 'HG19' : 'HG38'
  // Note: Exact Franklin URL format not documented in search results (LOW confidence)
  // This is a best-guess based on VarSome pattern—verify with Franklin documentation
  const variant = `${chr}:${pos}:${encodeURIComponent(ref)}:${encodeURIComponent(alt)}`

  return `https://franklin.genoox.com/clinical-db/variant/${genome}/${variant}`
}
```

### Pattern 2: Vuetify Item Slot for Clickable Cells
**What:** Use v-data-table-server's `item.<column>` slots to wrap data in clickable elements
**When to use:** For each column that should have external link functionality
**Example:**
```vue
<template>
  <v-data-table-server ...>
    <!-- Position column links to gnomAD -->
    <template #[`item.pos`]="{ item, value }">
      <span
        v-if="buildGnomadUrl(item.chr, value, item.ref, item.alt, genomeBuild)"
        class="external-link"
        @click="openExternal(buildGnomadUrl(item.chr, value, item.ref, item.alt, genomeBuild)!)"
      >
        {{ formatPosition(value) }}
        <v-icon size="x-small" class="ml-1">mdi-open-in-new</v-icon>
      </span>
      <span v-else class="genomic-coordinate">{{ formatPosition(value) }}</span>
    </template>

    <!-- ClinVar ID column links to ClinVar -->
    <template #[`item.clinvar_id`]="{ value }">
      <span
        v-if="buildClinvarUrl(value)"
        class="external-link"
        @click="openExternal(buildClinvarUrl(value)!)"
      >
        {{ value }}
        <v-icon size="x-small" class="ml-1">mdi-open-in-new</v-icon>
      </span>
      <span v-else>—</span>
    </template>
  </v-data-table-server>
</template>

<style scoped>
.external-link {
  cursor: pointer;
  color: rgb(var(--v-theme-primary));
  transition: all 0.2s ease;
}

.external-link:hover {
  text-decoration: underline;
}

.external-link.clicked {
  background-color: rgba(var(--v-theme-primary), 0.1);
}
</style>
```

### Pattern 3: Click Handler with Feedback
**What:** Handler that calls shell.openExternal with visual feedback and error handling
**When to use:** Every clickable external link
**Example:**
```typescript
// In VariantTable.vue <script setup>
const openExternal = async (url: string, event?: MouseEvent): Promise<void> => {
  if (!url) return

  // Add brief highlight to clicked element
  const target = event?.target as HTMLElement
  if (target) {
    target.classList.add('clicked')
    setTimeout(() => target.classList.remove('clicked'), 200)
  }

  // Call IPC
  if (typeof window.api !== 'undefined') {
    try {
      const result = await window.api.shell.openExternal(url)
      if (!result.success) {
        // Show snackbar notification
        snackbar.value = {
          visible: true,
          message: 'Could not open link',
          color: 'error'
        }
      }
    } catch (error) {
      console.error('Failed to open external link:', error)
      snackbar.value = {
        visible: true,
        message: 'Could not open link',
        color: 'error'
      }
    }
  }
}
```

### Pattern 4: Genome Build Detection
**What:** Detect genome build from imported data to construct correct database URLs
**When to use:** URL construction for build-specific databases (gnomAD, UCSC, VarSome, Franklin)
**Example:**
```typescript
// Option 1: Store genome build in Case metadata
// Add genome_build column to cases table during import detection
// Detect from VCF ##reference header or chromosome naming convention

// Option 2: Infer from data at runtime (if not stored)
function inferGenomeBuild(chr: string, pos: number): 'GRCh37' | 'GRCh38' {
  // Heuristic: chromosome naming (chr1 vs 1) not reliable
  // Better: store in Case metadata during import
  // Fallback: default to GRCh37 for now (most common legacy data)
  return 'GRCh37'
}

// Best practice: Add genome_build to Case interface and detect during import
```

### Anti-Patterns to Avoid
- **Opening unvalidated URLs:** Always validate URLs through shell.ts domain allowlist
- **Inline URL construction in template:** Use utility functions for testability
- **Synchronous link opening:** Use async/await, handle errors gracefully
- **Missing data without fallback:** Always show dash placeholder when link unavailable
- **Hard-coded genome build:** Detect from data or store in Case metadata

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| URL encoding | Manual string replacement | encodeURIComponent() | Handles edge cases (spaces, special chars, unicode) |
| External link security | Custom URL validation | Existing shell.ts domain allowlist | Already implements HTTPS-only + domain validation |
| Clickable table cells | Custom click tracking | Vuetify item slots | Native pattern, accessible, maintained |
| Hover styling | JavaScript hover state | CSS :hover pseudo-class | Simpler, better performance, native browser |
| Click feedback animation | setTimeout + flags | CSS transitions + transient class | Smoother, GPU-accelerated, cleaner code |

**Key insight:** The existing shell.ts implementation already provides production-ready security (HTTPS-only, domain allowlist). Don't create a second validation layer—just expand ALLOWED_DOMAINS array.

## Common Pitfalls

### Pitfall 1: Missing Genome Build Detection
**What goes wrong:** Links open to wrong gnomAD version (v2 vs v4) or wrong UCSC reference
**Why it happens:** Genome build not stored in imported data, hard-coded assumptions
**How to avoid:**
- Check VCF ##reference header during import for "GRCh37" or "GRCh38" strings
- Store genome_build in Case metadata (add column to cases table)
- If unavailable, default to GRCh37 (most common legacy) with logged warning
**Warning signs:** Users report gnomAD shows "variant not found" for valid variants

### Pitfall 2: Incorrect URL Encoding
**What goes wrong:** Links break for indels with special characters or long ref/alt alleles
**Why it happens:** Using template literals without encodeURIComponent
**How to avoid:** Always encode ref/alt alleles: `encodeURIComponent(ref)`, `encodeURIComponent(alt)`
**Warning signs:** Links fail for deletions (ref="ATCG", alt="-") or insertions

### Pitfall 3: Domain Allowlist Mismatch
**What goes wrong:** shell.openExternal rejects valid database URLs with "Domain not allowed"
**Why it happens:** Forgot to add domain to ALLOWED_DOMAINS array in shell.ts
**How to avoid:** Update shell.ts ALLOWED_DOMAINS before implementing renderer-side links
**Warning signs:** All link clicks fail with domain error in console

### Pitfall 4: ClinVar ID Confusion
**What goes wrong:** Users expect ClinVar ID column but current schema only has "clinvar" (significance)
**Why it happens:** Imported data may not include ClinVar variation IDs
**How to avoid:**
- Check imported data for ClinVar ID field availability
- If unavailable, don't add ClinVar ID link (or use chr:pos:ref:alt search URL as fallback)
- Document which data sources include ClinVar IDs
**Warning signs:** ClinVar links show search results instead of specific variation page

### Pitfall 5: OMIM MIM Number Unavailability
**What goes wrong:** OMIM links don't appear for most variants
**Why it happens:** MIM numbers are gene-level identifiers, not variant-level
**How to avoid:**
- Link OMIM only when MIM number present in imported data (show dash otherwise)
- Consider gene-level OMIM links instead of variant-level
- Check test-data schema for "OMIM" column (field 25 in column-schema.txt)
**Warning signs:** OMIM column always shows dashes

### Pitfall 6: Vuetify Slot Syntax Errors
**What goes wrong:** Item slots don't render or throw template errors
**Why it happens:** Incorrect slot name format (missing backticks or brackets)
**How to avoid:** Use exact syntax: `#[`item.column_name`]="{ item, value }"`
**Warning signs:** Template compilation errors mentioning slot names

## Code Examples

Verified patterns from official sources:

### Vuetify v-data-table Item Slot (Official Docs)
```vue
<!-- Source: https://vuetifyjs.com/en/components/data-tables/basics/ -->
<template>
  <v-data-table-server
    :headers="headers"
    :items="items"
  >
    <!-- Customize specific column -->
    <template #[`item.name`]="{ value }">
      <v-chip>{{ value }}</v-chip>
    </template>
  </v-data-table-server>
</template>
```

### Existing VariantTable.vue Item Slot Pattern
```vue
<!-- Source: src/renderer/src/components/VariantTable.vue (lines 16-19) -->
<template #[`item.pos`]="{ value }">
  <span class="genomic-coordinate">{{ formatPosition(value) }}</span>
</template>
```

### Existing shell.openExternal Usage (AppFooter.vue)
```typescript
// Source: src/renderer/src/components/AppFooter.vue (lines 115-126)
const openGitHub = async (): Promise<void> => {
  if (typeof window.api !== 'undefined') {
    try {
      const result = await window.api.shell.openExternal('https://github.com/berntpopp/varlens')
      if (!result.success) {
        console.error('Failed to open GitHub URL:', result.error)
      }
    } catch (error) {
      console.error('Failed to open GitHub URL:', error)
    }
  }
}
```

### Existing Domain Allowlist (shell.ts)
```typescript
// Source: src/main/ipc/handlers/shell.ts (lines 11-12)
const ALLOWED_DOMAINS = ['github.com', 'opensource.org']

// Expansion needed:
const ALLOWED_DOMAINS = [
  'github.com',
  'opensource.org',
  'gnomad.broadinstitute.org',
  'ncbi.nlm.nih.gov',
  'omim.org',
  'genome.ucsc.edu',
  'varsome.com',
  'franklin.genoox.com'
]
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate icon columns for links | Data values are the links | User decision (15-CONTEXT.md) | Cleaner table, fewer columns |
| Confirmation dialogs before opening | Immediate opening with feedback | User decision | Faster workflow, trust-based UX |
| Tooltips on hover | External link icon suffix | User decision | Less clutter, icon is sufficient signal |
| Manual URL construction | URL builder utilities | This phase | Testable, maintainable, reusable |

**Deprecated/outdated:**
- gnomAD v3: Now use v4 for GRCh38 (v4.1 released 2024-04)
- ClinVar search URLs: Use direct variation ID links instead

## Open Questions

Things that couldn't be fully resolved:

1. **Genome Build Detection Method**
   - What we know: VCF ##reference header may contain build info, can infer from known positions
   - What's unclear: Whether imported JSON data preserves VCF header metadata
   - Recommendation: Default to GRCh37 (legacy standard) with logged warning, plan Phase 16 for build selection UI

2. **Franklin URL Format**
   - What we know: Franklin is at franklin.genoox.com, supports HG19/HG38
   - What's unclear: Exact URL path structure for direct variant links (not documented in search results)
   - Recommendation: Test with sample variant, adjust format based on actual behavior (LOW confidence)

3. **ClinVar ID Availability**
   - What we know: Column schema has "OMIM" (field 25), current Variant interface has "clinvar" (significance)
   - What's unclear: Whether imported data includes ClinVar variation IDs
   - Recommendation: Check actual imported data structure, may need import service update to extract ClinVar IDs

4. **OMIM Data Level**
   - What we know: OMIM field exists in test data schema (field 25)
   - What's unclear: Whether this is gene-level MIM or variant-level
   - Recommendation: Inspect actual imported data, OMIM is typically gene-level

5. **Cell Click Highlight Duration**
   - What we know: User wants "brief highlight" for click feedback
   - What's unclear: Exact duration preference
   - Recommendation: Start with 200ms, Claude's discretion per CONTEXT.md

## Sources

### Primary (HIGH confidence)
- Electron shell.openExternal security: [Electron Security Documentation](https://www.electronjs.org/docs/latest/tutorial/security)
- Vuetify v-data-table slots: [Vuetify Data Tables Documentation](https://vuetifyjs.com/en/components/data-tables/basics/)
- Existing codebase: shell.ts, VariantTable.vue, AppFooter.vue (verified implementation patterns)

### Secondary (MEDIUM confidence)
- gnomAD v2 vs v4 URL format: [gnomAD v4.0 Announcement](https://gnomad.broadinstitute.org/news/2023-11-gnomad-v4-0/)
- ClinVar variation URL: [ClinVar Linking Documentation](https://www.ncbi.nlm.nih.gov/clinvar/docs/linking/)
- OMIM entry URL: [OMIM Linking Help](https://www.omim.org/help/linking)
- UCSC Genome Browser URL: [UCSC FAQ on Linking](https://genome.ucsc.edu/FAQ/FAQlink.html)
- VarSome variant URL: [VarSome Documentation](https://docs.varsome.com/en/submitted-vcf-requirements)
- VCF genome build detection: [Biostars Discussion](https://www.biostars.org/p/9532084/)

### Tertiary (LOW confidence)
- Franklin URL format: [Franklin Help Center](https://help.genoox.com/) (general info only, exact URL format unverified)
- Genome build heuristics: Community knowledge, no authoritative source for JSON-imported data

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All tools are existing dependencies with verified usage
- Architecture: HIGH - Patterns verified in current codebase (shell.ts, VariantTable.vue)
- URL formats (gnomAD, ClinVar, OMIM, UCSC, VarSome): MEDIUM - Based on official docs and WebSearch, not directly tested
- Franklin URL format: LOW - Not documented in search results, requires verification
- Genome build detection: MEDIUM - Methods known, but implementation depends on data availability
- Pitfalls: HIGH - Based on known Electron security issues and Vuetify patterns

**Research date:** 2026-01-27
**Valid until:** 60 days (stable domain - external database URLs change infrequently)

## Additional Notes

**Data model assumptions to verify:**
1. Current Variant interface (types.ts) has: chr, pos, ref, alt, clinvar (significance)
2. Does NOT have: clinvar_id, genome_build, omim_mim_number
3. Test data schema shows "OMIM" field exists (column 25) but not in TypeScript types
4. May need to add fields during import or extend Variant interface

**Implementation order recommendation:**
1. Expand ALLOWED_DOMAINS in shell.ts first
2. Create externalLinks.ts utility functions (testable in isolation)
3. Add genome build detection/storage (or default to GRCh37)
4. Update VariantTable.vue with item slots (one database at a time)
5. Add snackbar for error feedback
6. Test with real imported data to verify field availability

**Security note:**
Existing shell.ts implementation is production-ready. The domain allowlist pattern matches Electron security best practices: HTTPS-only, explicit domain allowlist, no protocol-based attacks (javascript:, file:, data: are already blocked by protocol check). No additional security layer needed.
