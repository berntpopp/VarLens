# Roadmap: Varlens v0.2.0

**Milestone:** v0.2.0 -- UI Polish, Branding & Trust Signals
**Phases:** 4 (Phase 9-12, continuing from v0.1 Phase 8)
**Requirements:** 29 v1 requirements across 3 categories
**Depth:** Balanced

## Overview

This milestone transforms Varlens from a bare POC into a professionally branded research tool with trust signals. The work delivers a warm-palette visual identity, a blocking research-use disclaimer, a searchable FAQ, a full-featured logging system, and a footer bar that integrates access to all of these. Phases are ordered by dependency: visual foundation first, then independent subsystems (logging, trust signals), then the footer that wires them together.

---

## Phase 9: Branding & Theme Foundation

**Goal:** App presents a consistent, professional visual identity with warm palette and research-appropriate language across all views.

**Dependencies:** None (foundation for all subsequent phases)

**Plans:** 2 plans

Plans:
- [x] 09-01-PLAN.md -- Warm palette theme config, custom DNA icon, monospace typography
- [x] 09-02-PLAN.md -- Branded app bar, sidebar refactor, language audit

**Requirements:**
- CHRM-08: App uses RequiForm warm palette (#a09588 primary, #E5AA94 footer background, #424242 secondary) via Vuetify theme config
- CHRM-09: All UI text uses "research" language -- no "clinical" references anywhere
- CHRM-01: App displays a top app bar with "VarLens" name and DNA icon across all views

**Success Criteria:**
1. User sees a warm-toned color scheme (#a09588 primary, #424242 secondary) applied consistently across all existing views -- sidebar, dialogs, tables, and toolbars all reflect the palette
2. User sees a top app bar with "VarLens" text and a DNA icon that persists across all navigation states (case list, variant table, empty state)
3. User finds zero instances of "clinical", "diagnostic", or "patient" language anywhere in the UI -- all text uses "research", "analysis", or "collaborator" framing instead

---

## Phase 10: Logging Infrastructure & Viewer

**Goal:** User has access to a full-featured log viewer that surfaces app activity, errors, and memory usage, backed by a robust logging service with data sanitization.

**Dependencies:** Phase 9 (theme must be applied so LogViewer uses correct palette)

**Plans:** 2 plans

Plans:
- [x] 10-01-PLAN.md -- Pinia log store with circular buffer, sanitizer utility, LogService facade
- [x] 10-02-PLAN.md -- LogViewer drawer UI with search, filtering, export, and app integration

**Requirements:**
- LOG-01: App has a LogService with debug/info/warn/error/critical log methods
- LOG-02: Log entries are stored in a Pinia store with circular buffer (configurable max entries)
- LOG-03: Log store tracks statistics (total received, dropped, per-level counts)
- LOG-10: Log configuration (max entries, level) is stored in localStorage and configurable via JSON
- LOG-11: Log sanitizer redacts sensitive genetic/medical data (HGVS notation, patient identifiers, genomic coordinates)
- LOG-04: User can open a LogViewer drawer from the footer button
- LOG-05: LogViewer supports full-text search across log messages
- LOG-06: LogViewer supports filtering by log level (multi-select)
- LOG-07: User can download logs as JSON export
- LOG-08: User can clear all logs from the viewer
- LOG-09: LogViewer displays memory usage statistics

**Success Criteria:**
1. User can open a LogViewer drawer (temporarily via a dev shortcut or floating button until footer exists in Phase 12) that displays a scrollable list of log entries with timestamps, levels, and messages
2. User can search log messages by text and filter by one or more log levels (debug, info, warn, error, critical), with results updating in real time
3. User can download all current logs as a JSON file and can clear the log buffer, with the viewer reflecting the empty state immediately
4. User observes that sensitive data (HGVS notation like "c.123A>G", genomic coordinates, patient identifiers) is automatically redacted in log messages -- replaced with "[REDACTED]" or equivalent placeholder
5. User can see memory usage statistics and log buffer statistics (total entries received, entries dropped, per-level counts) displayed in the LogViewer

---

## Phase 11: Trust Signals -- Disclaimer & FAQ

**Goal:** User encounters clear research-use-only framing on first launch and can access detailed FAQ content at any time, building confidence that the tool is transparent about its limitations.

**Dependencies:** Phase 9 (theme palette for dialog styling)

**Requirements:**
- TRST-09: Disclaimer text is configurable via JSON file
- TRST-01: User sees a blocking disclaimer dialog on first launch stating research-use-only purpose
- TRST-02: Disclaimer dialog lists specific limitations (not diagnostic, must be verified, no doctor-patient relationship)
- TRST-03: User must acknowledge disclaimer before accessing the app
- TRST-04: Disclaimer acknowledgment persists per app version in localStorage
- TRST-05: User can re-open disclaimer from footer button at any time
- TRST-08: FAQ content is loaded from a JSON configuration file (faqConfig.json)
- TRST-06: User can open FAQ dialog from footer button
- TRST-07: FAQ dialog displays searchable, categorized Q&A in expansion panels

**Success Criteria:**
1. User sees a blocking disclaimer dialog on first launch that lists specific limitations (research-use-only, not diagnostic, must be independently verified, no doctor-patient relationship) and cannot access the app until acknowledging it
2. User who has previously acknowledged the disclaimer for the current app version does not see the disclaimer again on subsequent launches -- but does see it again after a version upgrade
3. User can re-open the disclaimer dialog at any time (temporarily via keyboard shortcut or temporary button until footer exists in Phase 12)
4. User can open an FAQ dialog that shows categorized questions in expansion panels, with a search box that filters Q&A entries in real time, and the content matches what is defined in faqConfig.json

---

## Phase 12: App Footer Integration

**Goal:** User has a persistent footer bar that provides one-click access to version info, external links, disclaimer status, FAQ, and log viewer -- tying together all v0.2.0 subsystems into a cohesive app chrome.

**Dependencies:** Phase 10 (logging -- footer needs error count badge), Phase 11 (trust signals -- footer needs disclaimer status and FAQ trigger)

**Requirements:**
- CHRM-02: App displays a footer bar with version number accessible via popup menu
- CHRM-03: Footer includes GitHub repository link as small icon button
- CHRM-04: Footer includes license link as small icon button
- CHRM-05: Footer includes disclaimer acknowledgment status indicator
- CHRM-06: Footer includes FAQ dialog trigger button
- CHRM-07: Footer includes log viewer toggle button with error count badge

**Success Criteria:**
1. User sees a persistent footer bar (with #E5AA94 warm background) at the bottom of every view, containing small icon buttons that do not crowd the main content area
2. User can click a version element in the footer to see a popup menu displaying the current app version number
3. User can click icon buttons in the footer to open the GitHub repository and license page in their default browser
4. User can see at a glance whether the disclaimer has been acknowledged (visual indicator in footer), click a button to re-open the disclaimer, and click another button to open the FAQ dialog
5. User can click a log viewer toggle button in the footer that shows a badge with the current error count (0 when no errors), and clicking it opens/closes the LogViewer drawer

---

## Progress

| Phase | Name | Status | Requirements |
|-------|------|--------|--------------|
| 9 | Branding & Theme Foundation | ✓ Complete | CHRM-08, CHRM-09, CHRM-01 |
| 10 | Logging Infrastructure & Viewer | ✓ Complete | LOG-01 - LOG-11 |
| 11 | Trust Signals -- Disclaimer & FAQ | Not Started | TRST-01 - TRST-09 |
| 12 | App Footer Integration | Not Started | CHRM-02 - CHRM-07 |

## Coverage

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
| LOG-01 | Phase 10 | Complete |
| LOG-02 | Phase 10 | Complete |
| LOG-03 | Phase 10 | Complete |
| LOG-04 | Phase 10 | Complete |
| LOG-05 | Phase 10 | Complete |
| LOG-06 | Phase 10 | Complete |
| LOG-07 | Phase 10 | Complete |
| LOG-08 | Phase 10 | Complete |
| LOG-09 | Phase 10 | Complete |
| LOG-10 | Phase 10 | Complete |
| LOG-11 | Phase 10 | Complete |

**Total: 29/29 requirements mapped. No orphans.**

---
*Roadmap created: 2026-01-27*
*Milestone: v0.2.0 -- UI Polish, Branding & Trust Signals*
