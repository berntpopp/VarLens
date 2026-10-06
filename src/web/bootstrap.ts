/**
 * Web-mode entry point.
 *
 * The renderer (`src/renderer/src/main.ts`) reads `window.api`
 * synchronously during Vue setup, so the typed HTTP client must be installed
 * first. Both imports are STATIC (not `await import(...)`) so Vite puts
 * the renderer graph in the entry chunk and emits `modulepreload` hints:
 * the browser fetches the whole critical path in parallel from the HTML
 * instead of discovering it after the bootstrap chunk runs. Static
 * imports evaluate in source order — `install-api` runs before `main`.
 *
 * The renderer also has a `window.api === undefined` mock fallback;
 * because we assign first, that branch is never taken in web mode.
 */
import './client/install-api'
import '../renderer/src/main'
