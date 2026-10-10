import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { useCapabilityStore } from './stores/capabilityStore'
import { installQueryCache } from './queries/client'
import { installFocusRefetch } from './queries/focus-refetch'
import vuetify from './plugins/vuetify'
import router from './router'
import { installOverlayEscapeGuard } from './utils/overlay-escape-guard'
import './assets/styles/main.scss'
import type { WindowAPI } from '../../shared/types/api'

// Auto-inject mock API when running in browser mode (no Electron preload)
async function initializeMockApi(): Promise<void> {
  if (window.api === undefined) {
    if (import.meta.env.DEV) {
      console.log('[DEV] Browser mode detected - loading mock API...')
      const { mockApi } = await import('./mocks/mockApi')
      ;(window as Window & { api: WindowAPI }).api = mockApi
      console.log('[DEV] Mock API injected - ready for UI development')
    } else {
      throw new Error('Fatal: Electron preload API (window.api) is unavailable in production')
    }
  }
}

async function bootstrap(): Promise<void> {
  // Initialize mock API if needed (browser mode)
  await initializeMockApi()

  const app = createApp(App)

  // Register Pinia first so stores work in components and services
  const pinia = createPinia()
  app.use(pinia)
  installQueryCache(app, pinia)
  // Load the per-session capability document before the shell renders: the
  // store fails closed, so gated UI never flashes an action it then refuses.
  await useCapabilityStore(pinia).load()
  installFocusRefetch()
  app.use(router)
  app.use(vuetify)
  // Before the first overlay can open: Escape must never race Vuetify's
  // overlay-stack timer (every v-menu / v-dialog; see the guard's header).
  installOverlayEscapeGuard()
  app.mount('#app')
}

bootstrap()
