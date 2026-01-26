import type { WindowAPI } from '../shared/types/api'

declare global {
  interface Window {
    api: WindowAPI
  }
}

export {}
