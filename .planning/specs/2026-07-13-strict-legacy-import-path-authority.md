# Strict legacy import path authority

## Goal

Remove the remaining desktop renderer path-authority bypass from the legacy import IPC domain.
Every file consumed by `import:start`, `import:startMultiFile`, `import:vcfPreview`, or
`import:vcfMultiPreview` must have been enrolled by a trusted Electron selector or by an existing
derived-file workflow such as ZIP extraction.

## Design

The import path authority module will expose one capability boundary: an absolute, normalized path
must exist in the session-scoped `PathAuthorityStore`, and an enrolled symlink remains valid only
while it resolves to its originally pinned target. The automatic home, userData, and temp directory
fallback will be removed rather than retained behind a second predicate. Enrollment attempts using
relative or non-normalized paths fail closed instead of granting authority to a resolved alias.

Trusted selectors continue to enroll each returned file. Folder selection and ZIP extraction remain
responsible for enrolling each discovered or extracted file, rather than granting an entire directory
tree. Database authority remains owned by `database-path-allowlist.ts`. Web import routes remain
unchanged because they resolve user-scoped uploaded file references in the web server and do not
register the Electron IPC handlers.

## Error handling

Unenrolled paths retain the current structured `INVALID_PARAMETERS` response. Runtime schema
validation remains before authority validation. No IPC contract changes are required.

## Tests

- Invert the old automatic-root unit expectations so unenrolled home/temp files are rejected.
- Exercise all four path-consuming legacy import handlers with unenrolled temp paths.
- Exercise the handlers with explicitly enrolled paths.
- Prove an enrolled symlink is accepted while pinned and rejected after retargeting.
- Prove relative and non-normalized enrollment attempts do not authorize resolved aliases.
- Retain selector, folder, ZIP extraction, database, and web-gate coverage.
