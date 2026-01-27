# Phase 15: External Links - Context

**Gathered:** 2026-01-27
**Status:** Ready for planning

<domain>
## Phase Boundary

User can open variant-specific pages on gnomAD, ClinVar, OMIM, UCSC Genome Browser, VarSome, and Franklin directly from the variant table. Clickable data values in relevant columns serve as external links, secured by a domain allowlist. No configurable link settings in this phase.

</domain>

<decisions>
## Implementation Decisions

### Link placement & visual style
- No separate icon column — the data values themselves are the links
- Position text (chr:pos) links to gnomAD
- ClinVar ID links to ClinVar (use ClinVar ID from imported data, not constructed search)
- OMIM MIM number links to OMIM entry page
- Position also links to UCSC Genome Browser (separate column or dual-link)
- Variant components link to VarSome and Franklin (separate link columns)
- Clickable values are styled with a small external link icon suffix (arrow) after the text
- Underline appears on hover
- No tooltips on hover — the external link icon suffix is sufficient

### Missing data handling
- When OMIM MIM number is missing: show dash placeholder ("—"), no link
- gnomAD position link: link even with partial data (if chr and pos exist, link to region view)
- ClinVar: use ClinVar ID from imported file data; if no ClinVar ID, show dash placeholder
- VarSome/Franklin: require chr, pos, ref, alt for variant interpretation links; dash if missing

### Link behavior & feedback
- Click opens immediately in default browser (shell.openExternal) — no confirmation dialog
- Brief highlight on the clicked cell to confirm the click registered
- If shell.openExternal fails: snackbar notification ("Could not open link")
- No right-click context menu — just click-to-open behavior

### Database coverage & URL construction
- **gnomAD:** Detect genome build from imported data (GRCh37 → gnomAD v2, GRCh38 → gnomAD v4), link using chr-pos-ref-alt
- **ClinVar:** Direct link using ClinVar ID from imported data (e.g., `/variation/{id}`)
- **OMIM:** Direct MIM entry page using MIM number
- **UCSC Genome Browser:** Region view centered on variant position with narrow window (±25bp), genome build detected from data
- **VarSome:** Link using chr-pos-ref-alt with detected genome build
- **Franklin:** Link using chr-pos-ref-alt with detected genome build
- Domain allowlist expanded to include: gnomad.broadinstitute.org, ncbi.nlm.nih.gov, omim.org, genome.ucsc.edu, varsome.com, franklin.genoox.com

### Claude's Discretion
- Exact highlight animation duration and style
- How genome build detection works (which field in imported data to check)
- Column ordering for the link-bearing columns
- Exact URL path formats for each database (research the current URL structures)

</decisions>

<specifics>
## Specific Ideas

- Links should feel native to the data — the data IS the link, not a separate action button
- External link icon (↗) after clickable text gives a clear signal without tooltips
- ClinVar ID from the imported file is preferred over constructing a chr:pos:ref:alt search query

</specifics>

<deferred>
## Deferred Ideas

- Configurable external links settings — a settings menu where users can add/remove/configure link databases based on available data columns, with a nice configurator UI. This is a separate phase.
- Right-click "Copy link" context menu — could be added later if users request it

</deferred>

---

*Phase: 15-external-links*
*Context gathered: 2026-01-27*
