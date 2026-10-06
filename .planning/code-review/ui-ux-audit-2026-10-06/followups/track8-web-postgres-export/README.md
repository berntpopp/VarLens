# Track 8: web/PostgreSQL export hotfix

Branch `fix/web-postgres-export`. User-reported bug: in web mode, Export showed
"Export failed: variant export is not available for PostgreSQL yet."

## Root cause (confirmed)

- `src/web/server/routes/database.ts` overrode `database:capabilities` in web mode
  and forced `export: { variants: false, cohort: false, streaming: false }` unless the parity
  fixture mode was on. The renderer's `getUnsupportedReason()` turned that into the message.
- Even with the capability on, the `export:variants` / `export:cohort` RPC overrides only wrote a
  CSV into the server's `tmpdir()` and returned that path. A browser can never fetch it.
- The PostgreSQL side was already done: `PostgresExportRepository.streamVariantRows` and
  `PostgresCohortRepository.streamCohortRows` (pg-query-stream), with `POSTGRES_CAPABILITIES.export`
  all `true`.

## Fix

- `GET /api/export/variants/download` and `GET /api/export/cohort/download`
  (`src/web/server/routes/export-download.ts`) stream CSV from the pg query stream into the
  response. Headers: `Content-Disposition: attachment`, `text/csv; charset=utf-8`, `no-store`,
  `nosniff`. No temp files. The first row is read before headers go out, so an up-front query
  failure returns a JSON 500 instead of a truncated file. A client abort returns the row iterator,
  which ends the cursor and releases the pooled client.
- Auth uses the session preHandler (401), the route repeats the session check and applies the
  dispatcher's password-rotation gate (403). Params are checked with the same zod schemas as
  desktop (`VariantExportParamsSchema`, `CohortSearchParamsSchema`), and failures return 400.
  Each export writes an `api_read` audit row (`export:variants` / `export:cohort`).
- The web client (`src/web/client/export-download.ts`) implements `window.api.export.variants` /
  `.cohort` with a transient `<a download>` click. The browser's download manager streams the
  file, so it never sits in page memory. Electron is unchanged and still uses the save dialog.
- The `database:capabilities` override now passes the session capabilities through unchanged.
- The case and cohort views hide the "Open folder" snackbar action in web mode.

## Formats

Desktop on PostgreSQL offers **CSV only** (`export.ts` save dialog). Desktop on SQLite offers
XLSX through the worker. Web mode runs only on PostgreSQL, so it matches desktop PostgreSQL and
offers CSV. No dialog anywhere offers TSV. XLSX in the browser would need the whole workbook in
server memory (SheetJS `aoa_to_sheet` is not streaming), and no web UI control selects a format.
XLSX is therefore deferred and not part of this hotfix.

## Evidence

- `e2e-export-result.json`: headless Chromium against a built web instance (port 8890, schema
  `web_dev_track8`). The test logs in, imports a 30-variant case, opens SNV/Indel, applies the
  "HIGH Impact" preset and clicks Export. A `download` event fires and the CSV has 10 rows, all
  with `Consequence=HIGH`. Cohort view with "HIGH Impact" gives a `download` event and 10 cohort
  rows. The snackbar shows no "Open folder" action and the console has no errors.
- `tests/web-gate/integration/export-download.test.ts` runs on real PostgreSQL and checks status,
  headers, filtered CSV rows, cohort export, the audit rows, 401, 400, and that a client abort
  leaves no non-idle backend for the app's `application_name` (checked with a 40k-row case).
  When the release is mutated out, both abort tests fail.
