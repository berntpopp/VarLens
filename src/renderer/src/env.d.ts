/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

// Window API types - exposed via preload bridge
import type { WindowAPI } from '../../shared/types/api'

declare global {
  interface Window {
    api: WindowAPI
  }
}
