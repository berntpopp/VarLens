# Phase 14: Database Selection & Encryption UX - Context

**Gathered:** 2026-01-27
**Status:** Ready for planning

<domain>
## Phase Boundary

User can create, open, switch, and encrypt databases through the UI without restarting the app. Includes database picker, encryption password dialogs, current database indicator, and switch lifecycle. The underlying SQLCipher library is already in place from Phase 13. Database schema, import pipeline, and query infrastructure are unchanged.

</domain>

<decisions>
## Implementation Decisions

### Database picker flow
- Entry point is in the app bar / toolbar, always visible
- Clicking opens a dropdown menu showing recent databases plus "Open..." and "New..." options at the bottom
- App remembers the last 5 recently opened databases and shows them in the dropdown
- "New..." triggers a standard save-file dialog where the user picks name and location
- "Open..." triggers a standard open-file dialog filtered to .sqlite files
- First launch auto-creates a default database (same as current behavior) -- no onboarding prompt

### Password & encryption dialogs
- Encryption is opt-in: "Create New Database" flow has an "Encrypt with password" checkbox
- When checked, two password fields appear (password + confirm)
- Password dialog for opening encrypted databases is minimal: password field with show/hide toggle and OK button
- Wrong password shows an inline error in the dialog, user can retry with no attempt limit
- "Change password" option is accessible from the database dropdown menu (only visible when current DB is encrypted)

### Current database indicator
- App bar shows the database filename (not full path) plus a lock icon when the database is encrypted
- Full file path is shown as a tooltip on hover
- Clicking the database name opens the dropdown menu (name is the click target, no separate button)

### Switch & lifecycle feedback
- Small spinner in the app bar next to the database name during open/switch operations -- subtle, non-blocking
- Current view clears immediately when switching, shows loading state, then populates with new database data
- Failed open/switch shows a snackbar notification with the error message (auto-dismiss)
- If a switch fails, the app reverts to the previous database automatically so the user is never left with nothing

### Claude's Discretion
- Exact dropdown menu styling and animation
- Recent database list storage mechanism (electron-store, localStorage, etc.)
- Spinner style and positioning details
- Snackbar duration and positioning
- Password field validation timing (on-blur vs on-submit)
- Save/open dialog file extension filters

</decisions>

<specifics>
## Specific Ideas

No specific requirements -- open to standard approaches. The overall aesthetic should follow the existing warm palette theme established in v0.2.0.

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 14-database-selection-encryption-ux*
*Context gathered: 2026-01-27*
