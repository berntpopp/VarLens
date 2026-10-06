# Parity P-A: manifest gate, capabilities, typed web client, hardening

Branch `feat/parity-gate-capabilities` (from `integration/ui-ux-followups-2026-10` @ 0706969f).
Plan items PR-W2, PR-W3, PR-W11 of `.planning/plans/2026-10-06-desktop-web-parity-plan.md`.

## Manifest seed (current integration state)

222 `window.api` methods: 23 `pending` (baseline in `scripts/parity-baseline.json`), the rest
`shared`, `adapter` or `desktop-only`. Pending owners: cohort association 3 (P-C / PR-W13),
VEP 4, MyVariant 2, SpliceAI 2, PanelApp 2, StringDB 1 (P-C / PR-W7c), HPO 2 (P-C / PR-W7a),
protein 4 + gnomAD 2 (P-C / PR-W7d), panels.exportBed 1 (P-D / PR-W5).
Served-but-degraded methods carry a `degraded` note (import/batch cancel ownership, ZIP probe,
sibling BED discovery: P-B).

## Built web instance (127.0.0.1:8970, DB `varlens_pa_gate`, schema `web_pa_gate`, GIAB trio)

- `harness/verify.mjs` (Playwright, headless, admin): 16/16 pass — `verify-results.json`.
  Typed client (no catch-all, frozen), capability document (web/admin), `hpo.search` refused
  locally with no request, unbridged subscription throws, multi-file import offered (P-19),
  local IGV disabled with reason, no raw 404/501 from `/api/*` during the flow, no request to
  pending/desktop-only endpoints, axe 0 serious/critical on home and case + details panel,
  CLS home 0.0098.
- `harness/roles.mjs` (HTTP): 10/10 pass — non-admin document (role user, userAdmin off,
  `auth.listUsers` blocked), non-admin `audit.getByEntity` 200 and `audit.query` 403,
  `database.recentList` 404, alias `cohort:query` 404, `annotations.deleteGlobal` bad coords 400,
  anonymous `/api/openapi.json` 401.
- SPA shell CSP `connect-src` has no `localhost:60151` without `VARLENS_WEB_ALLOW_LOCAL_IGV=1`.
- Server started in development mode with no parity-manifest startup warning.
