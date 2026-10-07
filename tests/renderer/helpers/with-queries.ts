/**
 * Test helper: run a composable inside a mounted host component that has
 * Pinia and the query cache installed, the way src/renderer/src/main.ts does.
 * Pass the same `pinia` to several hosts to model components sharing a cache.
 */
import { createApp, type Plugin } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'

import { installQueryCache } from '../../../src/renderer/src/queries/client'
import { installCapabilities } from './capabilities'

export interface QueryHost<T> {
  result: T
  pinia: Pinia
  unmount: () => void
}

/** A fresh Pinia with a loaded capability document, set as the active one. */
export function createQueryPinia(): Pinia {
  const pinia = createPinia()
  setActivePinia(pinia)
  installCapabilities()
  return pinia
}

/** `global.plugins` for mounting a component that reads the query cache. */
export function queryPlugins(pinia: Pinia): Plugin[] {
  return [pinia, { install: (app) => installQueryCache(app, pinia) }]
}

export function withQueries<T>(
  composable: () => T,
  pinia: Pinia = createQueryPinia()
): QueryHost<T> {
  let result: T | undefined
  const app = createApp({
    setup() {
      result = composable()
      return () => null
    }
  })
  app.use(pinia)
  installQueryCache(app, pinia)
  app.mount(document.createElement('div'))
  return { result: result as T, pinia, unmount: () => app.unmount() }
}
