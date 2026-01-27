# Requirements: Varlens

**Defined:** 2026-01-27
**Core Value:** External collaborators can analyze variant data offline with a data-dense UX for research use

## v0.2.0 Requirements

Requirements for UI polish, branding, and trust signals milestone.

### App Chrome

- [x] **CHRM-01**: App displays a top app bar with "VarLens" name and DNA icon across all views
- [ ] **CHRM-02**: App displays a footer bar with version number accessible via popup menu
- [ ] **CHRM-03**: Footer includes GitHub repository link as small icon button
- [ ] **CHRM-04**: Footer includes license link as small icon button
- [ ] **CHRM-05**: Footer includes disclaimer acknowledgment status indicator
- [ ] **CHRM-06**: Footer includes FAQ dialog trigger button
- [ ] **CHRM-07**: Footer includes log viewer toggle button with error count badge
- [x] **CHRM-08**: App uses RequiForm warm palette (#a09588 primary, #E5AA94 footer background, #424242 secondary) via Vuetify theme config
- [x] **CHRM-09**: All UI text uses "research" language -- no "clinical" references anywhere

### Trust Signals

- [ ] **TRST-01**: User sees a blocking disclaimer dialog on first launch stating research-use-only purpose
- [ ] **TRST-02**: Disclaimer dialog lists specific limitations (not diagnostic, must be verified, no doctor-patient relationship)
- [ ] **TRST-03**: User must acknowledge disclaimer before accessing the app
- [ ] **TRST-04**: Disclaimer acknowledgment persists per app version in localStorage
- [ ] **TRST-05**: User can re-open disclaimer from footer button at any time
- [ ] **TRST-06**: User can open FAQ dialog from footer button
- [ ] **TRST-07**: FAQ dialog displays searchable, categorized Q&A in expansion panels
- [ ] **TRST-08**: FAQ content is loaded from a JSON configuration file (faqConfig.json)
- [ ] **TRST-09**: Disclaimer text is configurable via JSON file

### Logging

- [ ] **LOG-01**: App has a LogService with debug/info/warn/error/critical log methods
- [ ] **LOG-02**: Log entries are stored in a Pinia store with circular buffer (configurable max entries)
- [ ] **LOG-03**: Log store tracks statistics (total received, dropped, per-level counts)
- [ ] **LOG-04**: User can open a LogViewer drawer from the footer button
- [ ] **LOG-05**: LogViewer supports full-text search across log messages
- [ ] **LOG-06**: LogViewer supports filtering by log level (multi-select)
- [ ] **LOG-07**: User can download logs as JSON export
- [ ] **LOG-08**: User can clear all logs from the viewer
- [ ] **LOG-09**: LogViewer displays memory usage statistics
- [ ] **LOG-10**: Log configuration (max entries, level) is stored in localStorage and configurable via JSON
- [ ] **LOG-11**: Log sanitizer redacts sensitive genetic/medical data (HGVS notation, patient identifiers, genomic coordinates)

## Future Requirements

Deferred to later milestones.

### Core Features (v0.3+)

- **FEAT-01**: Virtual gene panels for targeted variant filtering
- **FEAT-02**: Advanced inheritance filters (de novo, compound het)
- **FEAT-03**: Statistics dashboard with variant summary metrics
- **FEAT-04**: PDF report generation
- **FEAT-05**: External links integration (OMIM, ClinVar, gnomAD)

### Nice-to-Have (unscheduled)

- **NICE-01**: Dark mode toggle
- **NICE-02**: Keyboard shortcuts
- **NICE-03**: Internationalization (i18n) support

## Out of Scope

| Feature | Reason |
|---------|--------|
| Real-time collaboration | Offline-first desktop app |
| Cloud sync | Not in v0.x scope |
| VCF import | JSON-only for POC |
| CNV/SV analysis | SNV-focused for POC |
| User authentication | Desktop app, single-user |
| Runtime branding config | Build-time JSON sufficient for v0.2.0; runtime override deferred |
| Clinical diagnostic language | Research use only -- explicitly excluded |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CHRM-01 | Phase 9 | Complete |
| CHRM-02 | Phase 12 | Pending |
| CHRM-03 | Phase 12 | Pending |
| CHRM-04 | Phase 12 | Pending |
| CHRM-05 | Phase 12 | Pending |
| CHRM-06 | Phase 12 | Pending |
| CHRM-07 | Phase 12 | Pending |
| CHRM-08 | Phase 9 | Complete |
| CHRM-09 | Phase 9 | Complete |
| TRST-01 | Phase 11 | Pending |
| TRST-02 | Phase 11 | Pending |
| TRST-03 | Phase 11 | Pending |
| TRST-04 | Phase 11 | Pending |
| TRST-05 | Phase 11 | Pending |
| TRST-06 | Phase 11 | Pending |
| TRST-07 | Phase 11 | Pending |
| TRST-08 | Phase 11 | Pending |
| TRST-09 | Phase 11 | Pending |
| LOG-01 | Phase 10 | Pending |
| LOG-02 | Phase 10 | Pending |
| LOG-03 | Phase 10 | Pending |
| LOG-04 | Phase 10 | Pending |
| LOG-05 | Phase 10 | Pending |
| LOG-06 | Phase 10 | Pending |
| LOG-07 | Phase 10 | Pending |
| LOG-08 | Phase 10 | Pending |
| LOG-09 | Phase 10 | Pending |
| LOG-10 | Phase 10 | Pending |
| LOG-11 | Phase 10 | Pending |

**Coverage:**
- v0.2.0 requirements: 29 total
- Mapped to phases: 29
- Unmapped: 0

---
*Requirements defined: 2026-01-27*
*Last updated: 2026-01-27 after roadmap creation (phase traceability added)*
