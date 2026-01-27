# Phase 9: Branding & Theme Foundation - Context

**Gathered:** 2026-01-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish a consistent, professional visual identity with warm palette and research-appropriate language across all existing views. Delivers: Vuetify theme configuration with warm palette, a branded top app bar with "VarLens" name and custom DNA icon, and a full language audit replacing clinical terminology with research framing. Does NOT include footer (Phase 12), logging UI (Phase 10), or trust signal dialogs (Phase 11).

</domain>

<decisions>
## Implementation Decisions

### Palette depth
- Surfaces get subtle warm tints (light tan/cream backgrounds, warm grays) -- the whole app feels warm, not just accents
- Status/feedback colors (success, error, warning, info) are warm-shifted to feel part of the palette -- warm green, warm red, warm amber
- RequiForm is the gold-standard reference for palette execution -- match its feel as closely as possible
- Both light AND dark theme variants must be defined in this phase -- full dual-theme support from the start

### App bar design
- Bar color: primary (#a09588) with white text -- strong brand statement at the top
- DNA icon: custom SVG unique to VarLens -- not a stock Material Design icon
- Sidebar/nav toggle: research best practices for intuitive sidebar/nav toggle UX (researcher should investigate patterns from data-dense tools and recommend approach)
- Bar height: compact/dense (~48px) -- maximize content area for data-heavy views

### Typography & density
- Font family: Roboto (Vuetify default) -- no custom typeface
- Table density: compact -- small rows, tight padding, maximize visible data rows
- Global spacing: compact treatment across all components (card padding, dialog margins, section gaps) -- consistent data-dense feel everywhere
- Monospace font for variant data: yes -- HGVS notation, gene symbols, genomic coordinates rendered in monospace to distinguish technical data from regular text

### Language audit scope
- Full sweep of every string in the UI -- labels, tooltips, error messages, placeholders, empty states, dialog text. Zero clinical terms anywhere user-visible
- UI strings only -- code internals (variable names, comments) are not in scope
- Replacement vocabulary: "research", "analysis", "collaborator" as specified in roadmap. Claude picks best fit per context.
- The term "case" is acceptable -- it's neutral enough for research context (case study, case report). No rename needed.

### Claude's Discretion
- Exact warm tint hex values for surfaces and backgrounds (derived from anchor colors)
- Specific warm-shifted status color hex values (balancing palette harmony and accessibility)
- Dark theme color mapping (warm palette adapted for dark surfaces)
- Custom SVG DNA icon design
- Sidebar/nav toggle implementation (informed by researcher findings)
- Exact compact spacing values across components
- Monospace font choice for variant data
- Specific replacement wording for each clinical term found in the audit

</decisions>

<specifics>
## Specific Ideas

- RequiForm is the palette reference -- match its warm, professional feel
- Compact/dense feel throughout, similar to data-dense tools like Linear
- Custom SVG DNA icon should feel unique to VarLens, not generic
- "VarLens" branding should be prominent but the compact bar keeps it from dominating

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 09-branding-theme-foundation*
*Context gathered: 2026-01-27*
