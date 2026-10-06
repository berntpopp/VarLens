/**
 * Side-effect module: installs the HTTP `window.api` Proxy and the web
 * runtime marker. `src/web/bootstrap.ts` imports this BEFORE the renderer
 * entry; ES modules evaluate their static imports in order, so the
 * renderer sees `window.api` already set when its setup code runs.
 */
import type { WindowAPI } from '../../shared/types/api'
import { createApi } from './api'
;(window as Window & { api: WindowAPI; __VARLENS_WEB__: true }).__VARLENS_WEB__ = true
;(window as Window & { api: WindowAPI }).api = createApi()
