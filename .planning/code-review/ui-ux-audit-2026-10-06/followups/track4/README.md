# Track 4: web-mode completeness — verification evidence

Branch `feat/web-mode-completeness`. Built web instance on `127.0.0.1:8840` (throwaway
Postgres DB `varlens_track4`, schema `web_dev_track4`, GIAB trio seeded with
`harness/seed.mjs`). All checks run headless (Playwright Chromium, 1440×900).

- `settings-admin-inventory.md` — every Settings / admin action, before vs. after, with root
  causes (input for the desktop↔web parity spec).
- `evidence/settings-probe-before.json`, `evidence/settings-probe-after.json` — raw probe output
  (`harness/probe2.mjs`). "Before" ran on the branch's first commit (theme/copy only), i.e. the
  settings/admin code paths were identical to `main`.
- `evidence/web-route-map.tsv` — every `window.api` method → how the web dispatcher resolves it
  (`harness/route-map.cjs`).

## URL state (`harness/urlstate.mjs`, `evidence/urlstate.json`)

All 20 checks pass (two consecutive runs):

- case selection → `?case=`; tab → `?tab=`; header sort → `?sort=gene_symbol`; search → `?q=`;
  quick filter → `?f={"i":["HIGH"]}`.
- reload restores case, tab, search text, sort header state and filter chip.
- case switch adds one history entry; back restores the previous case *with* its tab, sort and
  search; forward returns.
- case → cohort → case keeps the case query; cohort writes/restores `sort`, `q`, `f` on reload.

## ACMG confirm + undo (`harness/acmg.mjs`)

```
PASS criterion click does not write writes=0
PASS confirm bar shows draft summary Unsaved: Uncertain significance · 8 pts · PVS1
PASS apply writes once writes=1
PASS undo snackbar after apply Classified as Uncertain significance Undo Close
PASS undo writes the previous state {"acmg_classification":null,"acmg_evidence":""}
PASS quick pick shows undo Classified as Likely pathogenic Undo Close
PASS quick pick undo restores [... "Likely pathogenic" ..., ... null ...]
```

## axe (serious/critical), light + dark (`harness/axe.mjs`)

States: home, case shortlist, case table, case + details panel, account menu, user
management, cohort — each in `warmLight` and `warmDark` (theme set through the persisted
preference, see below).

| Finding | Before this track's fixes (`evidence/axe-mid-light-dark.json`) | After (`evidence/axe-after-light-dark.json`) |
|---|---|---|
| Account menu `aria-required-children` / `aria-required-parent` | 1 + 3 nodes (light + dark) | 0 |
| User management dialog `aria-dialog-name` | 1 (light + dark) | 0 |
| App bar "Select a case…" hint (dark) 4.34:1 — track 6 expected-fail | failing in track 6 gate | fixed (no opacity on the text) |
| Active sidebar case subtitle (`.v-list-item--active .v-list-item-subtitle`) 2.9–3.1:1 | 2–3 nodes per case state | unchanged — **owned by track 6** (`a11y.css` active list-item subtitle opacity) |
| Cohort `v-select` floating label 4.43:1 (light) | 2 nodes | unchanged — **owned by track 6** (`a11y.css` `.v-field-label` opacity) |

No other serious/critical violations in either theme; home and cohort are clean in dark.

## Theme toggle (for the track 6 gate)

- Persisted preference: `localStorage['varlens_user_settings_v1'].themePreference` =
  `'system' | 'light' | 'dark'`. Read synchronously before mount
  (`utils/theme-preference.ts` → `plugins/vuetify.ts`), so setting it in an init script and
  loading the page renders the dark theme from the first paint.
- UI: Application Preferences → `[data-testid="theme-preference-toggle"]` (buttons
  System / Light / Dark); web account menu → `[data-testid="account-menu"]` → items with
  `aria-label="Theme: Dark"` etc.
- Vuetify theme names unchanged: `warmLight` / `warmDark` (`useTheme().change('warmDark')`
  still works but is overwritten on the next preference change).
