import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import vuetify from './plugins/vuetify'
import router from './router'
import './assets/styles/main.scss'
import type { WindowAPI } from '../../shared/types/api'

// Auto-inject mock API when running in browser mode (no Electron preload)
async function initializeMockApi(): Promise<void> {
  if (window.api === undefined) {
    console.log('[DEV] Browser mode detected - loading mock API...')
    const { mockApi } = await import('./mocks/mockApi')
    ;(window as Window & { api: WindowAPI }).api = mockApi
    console.log('[DEV] Mock API injected - ready for UI development')
  }
}

async function bootstrap(): Promise<void> {
  // Initialize mock API if needed (browser mode)
  await initializeMockApi()

  const app = createApp(App)

  // Register Pinia first so stores work in components and services
  app.use(createPinia())
  app.use(router)
  app.use(vuetify)
  app.mount('#app')
}

bootstrap()
