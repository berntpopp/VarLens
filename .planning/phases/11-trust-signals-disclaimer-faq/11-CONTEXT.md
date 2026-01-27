# Phase 11: Trust Signals — Disclaimer & FAQ - Context

**Gathered:** 2026-01-27
**Status:** Ready for planning

<domain>
## Phase Boundary

User encounters clear research-use-only framing on first launch via a blocking disclaimer dialog and can access searchable FAQ content at any time. Disclaimer text is configurable via JSON. FAQ content is loaded from faqConfig.json. This phase does NOT include the footer bar (Phase 12) — temporary keyboard shortcuts provide access until then.

</domain>

<decisions>
## Implementation Decisions

### Disclaimer dialog design
- Firm but friendly tone — clear limitations stated in approachable language, not legalese or scary
- Centered modal dialog (not full-screen takeover) — app chrome visible but dimmed behind overlay
- Single "I Understand — Continue" button for acknowledgment (no checkbox required)
- Limitations presented as a numbered list with small icons beside each item for visual hierarchy
- Limitation items: not for diagnostic use, must be independently verified, no doctor-patient relationship

### Version-gated persistence
- Any app version change triggers re-acknowledgment (0.2.0 → 0.2.1 counts)
- Store only the acknowledged version string in localStorage (no timestamp)
- Version check runs only on app launch — no mid-session watching for version changes
- No separate content version for disclaimer text — app version is sufficient

### FAQ content & interaction
- Single collapsible list layout with search functionality (not tabs)
- FAQ content should reflect research best practices and community standards for genomic research tools
- Multiple expansion panels can be open simultaneously (not accordion)
- Friendly empty state when search matches nothing: "No matching questions found" with suggestion to rephrase
- Compact centered dialog (~600px width), not full-width

### Temporary access (pre-footer)
- Keyboard shortcuts: Ctrl+Shift+D for disclaimer, Ctrl+Shift+Q for FAQ
- Dev-only knowledge — no UI hints or tooltips about shortcuts
- Shortcuts are kept permanently as secondary/power-user access even after footer is built in Phase 12

### Claude's Discretion
- Exact disclaimer dialog dimensions and padding
- Icon choices for the numbered limitation items
- Search implementation details (debounce, matching algorithm)
- FAQ category names and initial question set structure in faqConfig.json
- Expansion panel styling details
- localStorage key naming convention

</decisions>

<specifics>
## Specific Ideas

- Research best practices and community standards for genomic research tool disclaimers/FAQs should inform the content (user wants this researched via web search during planning)
- Reference projects: phentrieve (disclaimer patterns), RequiForm (FAQ patterns)
- Dialog should use the warm palette from Phase 9 (already established theme)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 11-trust-signals-disclaimer-faq*
*Context gathered: 2026-01-27*
