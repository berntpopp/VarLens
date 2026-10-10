/// <reference types="vite/client" />
/// <reference path="./vuetify-styles.d.ts" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

// Window API types - exposed via preload bridge
import type { WindowAPI } from '../../shared/types/api'

declare global {
  const __APP_VERSION__: string
  interface Window {
    api: WindowAPI
    __VARLENS_WEB__?: boolean
  }
}
