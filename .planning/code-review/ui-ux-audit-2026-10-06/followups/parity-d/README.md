# Parity P-D — roles, audit registry, export artifacts (web verification)

Branch `feat/parity-roles-exports` (PR-W8 server half + PR-W5), merged with
P-A `feat/parity-gate-capabilities`.

## Built web instance

- `VARLENS_WEB_BASE=/ npm run build:web`, server on `127.0.0.1:9000`
  (metrics 9300), throwaway database `varlens_parity_d`, schema `parity_d`.
- `harness/seed.mjs` creates `ana` (analyst) and `vic` (viewer) through
  `auth:createUser(…, role)`, rotates their temporary passwords, probes
  `auth:resetPassword` for an unknown and a known user, and imports
  `tests/test-data/vcf/synthetic-unit-test.vcf` as "Parity D Case".
- `harness/verify.mjs` (headless Chromium, axe-core) logs in as viewer,
  analyst and admin. Result: **40/40 checks passed** (`verify-results.json`).

## What the run shows

| Check | viewer | analyst | admin |
|---|---|---|---|
| capability document role | viewer | analyst | admin |
| Read-only chip | shown | — | — |
| import (sidebar `+`, settings menu) | hidden | offered | offered |
| shortlist + variant-table star | disabled | enabled | enabled |
| export | disabled, `prepareDownload` → 403 `role-required` | CSV + XLSX downloads (16 rows; XLSX has Variants + Export Info) | same |
| raw `fetch('/api/tags/create')` bypassing the client | 403 `role-required` | — | — |
| download link reuse | — | 1st 200, 2nd 404 | 1st 200, 2nd 404 |
| Delete All Cases | hidden | hidden | offered |
| axe serious/critical (home, case, settings menu) | 0 | 0 | 0 |

Password reset (seed output): unknown user and real user both answer
`202 {"accepted":true}`; the audit row records `success:false,
reason:user-not-found` for the unknown one.

## Download design (signed vs cookie GET)

Signed, single-use, user-bound, 60 s grants minted by a CSRF-gated POST
(`export:prepareDownload`), redeemed by `GET /api/download/:token` with the
session cookie still required. Rationale in
`src/web/server/downloads/download-grants.ts`.
