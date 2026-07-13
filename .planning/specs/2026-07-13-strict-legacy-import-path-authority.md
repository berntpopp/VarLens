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
tree. Database authority remains owned by `database-path-allowlist.ts`. Web imports continue to
resolve user-scoped uploaded file references rather than registering Electron IPC handlers; their
client and ZIP route mirror the revised desktop contract without sharing desktop path authority.

Database dialog enrollment uses the same lexical and symlink-pinning rules. Relative or
non-normalized database enrollment is ignored. If a dialog-enrolled database symlink is later
retargeted, the stale enrollment fails closed; matching the current or recent database list must
not resurrect that stale capability.

ZIP extraction ownership is represented by an opaque extraction ID. Every active extraction owns
its temporary directory and the exact import-path enrollments derived from it. Cleanup accepts only
that ID, revokes only those enrollments, and remains safe when extraction and cleanup requests race.

Two trusted derived-path workflows remain usable without weakening the import gate:

- Sibling BED files discovered by main while previewing already-authorized VCFs are individually
  enrolled before being returned.
- Dropped browser `File` objects are converted to native paths in preload with Electron
  `webUtils.getPathForFile`; only those preload-derived normalized VCF paths are sent to main for
  enrollment. The renderer cannot enroll a raw path string through the exposed API.

Export reveal is a separate capability. Export handlers enroll successful save targets in an
export-only store and expose an export-scoped reveal operation. Import authority never authorizes
revealing a file, and the generic shell API no longer exposes that operation.

## Error handling

Unenrolled paths retain the current structured `INVALID_PARAMETERS` response. Runtime schema
validation remains before authority validation. The typed IPC contract carries opaque ZIP
extraction IDs for targeted cleanup, preload-provenance enrollment for dropped files, and an
export-scoped reveal operation. Desktop, renderer mocks, and the web client preserve the same API
shape; unsupported web reveal requests return an explicit failed `IpcResult`.

## Tests

- Invert the old automatic-root unit expectations so unenrolled home/temp files are rejected.
- Exercise all four path-consuming legacy import handlers with unenrolled temp paths.
- Exercise the handlers with explicitly enrolled paths.
- Prove an enrolled symlink is accepted while pinned and rejected after retargeting.
- Prove relative and non-normalized enrollment attempts do not authorize resolved aliases.
- Retain selector, folder, ZIP extraction, database, and web-gate coverage.
- Prove stale database symlinks cannot fall through to current/recent authority.
- Prove concurrent ZIP extraction cleanup revokes only the addressed extraction.
- Prove sibling-BED suggestions and genuine dropped files remain importable through trusted
  enrollment, while raw renderer strings remain rejected.
- Prove export reveal accepts only export-enrolled targets and import enrollment is insufficient.
