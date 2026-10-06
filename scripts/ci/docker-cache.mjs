import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { acquireLock } from './lock.mjs'

/** Keep one layer graph, replaced only after validation; no developer builder is reused. */
export async function dockerLayerCache(directory) {
  await mkdir(directory, { recursive: true })
  const unlock = acquireLock(join(directory, 'cache.lock'))
  const current = join(directory, 'current')
  const previous = join(directory, 'previous')
  let next
  try {
    // Recover the short rename window after an interrupted successful export.
    if (!existsSync(current) && existsSync(previous)) await rename(previous, current)
    for (const entry of await readdir(directory)) {
      if (/^next-[A-Za-z0-9]{6}$/.test(entry)) {
        await rm(join(directory, entry), { recursive: true, force: true })
      }
    }
    next = await mkdtemp(join(directory, 'next-'))
    return {
      // BuildKit verifies content-addressed blobs. Exporting layers cannot
      // preserve RUN --mount=type=cache contents such as npm/compression caches.
      args: [
        ...(existsSync(join(current, 'index.json'))
          ? ['--cache-from', `type=local,src=${current}`]
          : []),
        '--cache-to',
        `type=local,dest=${next},mode=max`
      ],
      async publish() {
        const index = JSON.parse(await readFile(join(next, 'index.json'), 'utf8'))
        if (index.schemaVersion !== 2 || !index.manifests?.length) {
          throw new Error('BuildKit did not export a valid local layer cache')
        }
        await rm(previous, { force: true, recursive: true })
        if (existsSync(current)) await rename(current, previous)
        try {
          await rename(next, current)
        } catch (error) {
          if (existsSync(previous)) await rename(previous, current)
          throw error
        }
      },
      async close() {
        try {
          await rm(next, { force: true, recursive: true })
          if (existsSync(current)) await rm(previous, { force: true, recursive: true })
        } finally {
          unlock()
        }
      }
    }
  } catch (error) {
    unlock()
    throw error
  }
}
