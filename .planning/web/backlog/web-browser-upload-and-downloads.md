# Browser Upload And Download Support

Status: backlog
Created: 2026-05-12

## Why This Exists

The current web import path is deliberately limited to server-local paths for tests and operators:

- enabled automatically only under `NODE_ENV=test`
- otherwise gated by `VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT=1`

That is sufficient for parity tests and sysadmin-operated resources, but it is not end-user browser import. Browser users cannot hand the server a local filesystem path.

The current web export path is also deliberately gated. PostgreSQL storage can stream rows, but the web app does not yet turn those rows into browser downloads with a clear file lifecycle.

## Target Behavior

- Browser upload accepts VCF/JSON input through an authenticated upload endpoint.
- The server stages uploaded files in a short-lived staging area. In hosted mode
  the staging scope is per-workspace and per-user; in `single` mode it degrades
  to per-user because there is no workspace boundary.
- Staged uploads and downloads are `case_data`: encrypted/isolated according to
  the deployment storage policy, not written to normal logs, and not copied into
  public annotation storage.
- Import calls use staged file IDs, not client filesystem paths; staged IDs are
  resolvable only for the owning authenticated user/session and bound workspace.
- Staged files are deleted after successful import, failed import cleanup,
  explicit cancel, or TTL expiry; cleanup failures are observable without
  serializing filenames or payload contents into normal logs.
- Browser export returns a download response or staged download ID, not a desktop `filePath`.
- Desktop file dialogs and `showItemInFolder` remain desktop-only.

## Acceptance Checks

- Web tests prove upload/import/delete cleanup for success and failure.
- Hosted-mode tests prove cross-user and cross-workspace staged-ID reuse is
  rejected; `single` mode tests prove cross-user reuse is rejected.
- A parity test imports through the browser upload contract, not `VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT`.
- Export tests prove variant and cohort downloads produce deterministic content for the same filters used in desktop export tests.
- Default desktop `make test` remains unchanged; upload/download tests run only in web lanes.
