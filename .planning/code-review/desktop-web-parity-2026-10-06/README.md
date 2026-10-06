# Desktop ↔ web parity audit (2026-10-06)

Raw evidence for `.planning/specs/2026-10-06-desktop-web-parity-spec.md` and
`.planning/plans/2026-10-06-desktop-web-parity-plan.md`.

| File | What |
|---|---|
| `01-static-inventory.md` / `.json` | Static inventory of all 217 `window.api` methods: web mechanism, classification, capability flags, renderer gates, event channels, and test blind spots |
| `02-limin-comparison.md` | How Limin reaches parity (file:line citations) and the adopt / adapt table |
| `03-best-practices.md` | External research, 2025–2026 sources |
| `04-empirical-web-crawl.md` | Headless Playwright crawl of a built web instance as admin (102 steps) |
| `empirical/crawl-results.json`, `tables.md` | Per-step results: status, console errors, failed requests |
| `empirical/api-probe.json`, `api-surface.json` | Authenticated probe of every API method, and the server route surface |
| `empirical/screens/` | Screenshots of the failing steps |
| `empirical/scripts/` | Crawl and probe scripts. Set `VARLENS_CRAWL_PASSWORD` to the dev admin password and start a server with `start-server.sh` (port 8900, schema `web_dev_parity`) |
| `inventory-scripts/` | Python that regenerates the static inventory |

Run environment: commit 8a662b89, built with `VARLENS_WEB_BASE=/ npm run build:web` against Postgres on 127.0.0.1:55434. The data was imported in the browser from `tests/test-data/vcf` (single sample plus the Chinese trio) and `demo-case.json`.
