# Brand assets & icons

How the VarLens icon is drawn and turned into every desktop, web and docs asset.

## The mark

A protein lollipop plot whose tallest variant is a magnifying lens, leaning in to
inspect; the amber head inside the glass is the variant. Graphite tile, silver
ring, one amber accent. Chosen in the October 2026 icon exploration (canvas:
claude.ai artifact "VarLens Icon Explorations").

## Source of truth: four vector drawings

`resources/brand/` holds one SVG per size range. Small sizes are redrawn, not
scaled: each keeps the leaning lens, the amber arc and the amber variant, and
drops detail as it shrinks.

| File | Used at | Notes |
|---|---|---|
| `varlens-full.svg` | 128 px and up | Glass, shadow, four neighbour lollipops |
| `varlens-m.svg` | 48–64 px | Two neighbours, strokes ×1.5 |
| `varlens-s.svg` | 24–32 px | 32 px grid, flat colour, no filters |
| `varlens-xs.svg` | 16 px | 16 px grid, nothing thinner than 1 px |

`varlens-s.svg` and `varlens-xs.svg` keep straight edges on whole pixels so they
render sharp. Edit the SVGs, never the generated rasters.

## Generated assets

`npm run icons:generate` (`scripts/brand/build-icons.mjs`, needs `rsvg-convert`)
writes everything below from those four files. Each raster size takes the drawing
for its range; `.ico` and `.icns` embed one PNG per size.

| Output | From |
|---|---|
| `build/icon.icns` | macOS grid (824 px body on 1024, soft shadow) for ≥128; pixel-grid drawings for 16–64 |
| `build/icon.ico`, `resources/icon.ico` | 16–256, per size range |
| `build/icons/NxN.png`, `build/icon.png` | Linux set, per size range |
| `resources/icon.png`, `resources/icon.svg` | Dev-mode window icon (`src/main/index.ts`), full master |
| `src/renderer/public/favicon.svg` | Copy of `varlens-s.svg` (tab icon, login-wall logo) |
| `src/renderer/public/favicon.ico` | 16/32/48 |
| `src/renderer/public/apple-touch-icon.png` | 180, opaque square tile (iOS applies its own mask) |
| `src/renderer/public/icon-192.png`, `icon-512.png` | PWA "any" icons |
| `src/renderer/public/icon-maskable-512.png` | Opaque tile, art inside the 80% safe zone |
| `docs/public/logo.svg` | Copy of `varlens-m.svg` (docs nav, docs favicon, README) |

The renderer toolbar imports `resources/brand/varlens-s.svg` directly as a Vite
asset (`AppToolbar.vue`), so the in-app mark is vector too.

## Head wiring and the login wall

`src/renderer/index.html` and `src/web/login/login.html` link `favicon.ico`,
`favicon.svg` and `apple-touch-icon.png`; `src/web/index.html` links
`favicon.svg`. The web page gate (`src/web/server/page-gate.ts`) lets
these public files through to anonymous visitors, so the login tab and its logo
load before sign-in. The web renderer build copies the set explicitly
(`vite.web-renderer.config.ts`).
