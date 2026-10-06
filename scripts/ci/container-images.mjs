import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'

const RECEIPT = 'org.varlens.ci.receipt'
const WORKTREE = 'org.varlens.ci.worktree'

/** One retained validation image per canonical worktree; never remove foreign images. */
export function receiptImages(docker, options) {
  const worktree = createHash('sha256')
    .update(realpathSync(options.cwd ?? process.cwd()))
    .digest('hex')
  const image = `varlens-ci-${worktree.slice(0, 20)}:validated`
  const owns = (details) =>
    details?.Config?.Labels?.[RECEIPT] === 'true' && details.Config.Labels[WORKTREE] === worktree
  const cleanupOptions = { ...options, signal: undefined }
  async function inspect(reference, cleanup = false) {
    try {
      return JSON.parse(
        String(
          (await docker(['image', 'inspect', reference], cleanup ? cleanupOptions : options)).stdout
        )
      )[0]
    } catch (error) {
      if (error.exitCode === 1 && /No such image/i.test(String(error.stderr))) return null
      throw error
    }
  }
  async function discard(metadata) {
    const current = await inspect(image, true)
    if (current?.Id === metadata.imageId && owns(current))
      await docker(['image', 'rm', image], cleanupOptions)
  }
  return {
    labelArgs: ['--label', `${RECEIPT}=true`, '--label', `${WORKTREE}=${worktree}`],
    discard,
    async retain(metadata) {
      const previous = await inspect(image)
      if (previous && !owns(previous))
        throw new Error('Receipt image tag is not owned by this worktree')
      const candidate = await inspect(metadata.imageId)
      if (!owns(candidate)) throw new Error('Validated image is not owned by this worktree')
      const listed = await docker(
        [
          'image',
          'ls',
          '--quiet',
          '--no-trunc',
          '--filter',
          `label=${RECEIPT}=true`,
          '--filter',
          `label=${WORKTREE}=${worktree}`
        ],
        options
      )
      const oldIds = new Set(String(listed.stdout).split(/\s+/).filter(Boolean))
      if (previous) oldIds.add(previous.Id)
      try {
        await docker(['tag', metadata.imageId, image], options)
        for (const oldId of oldIds) {
          if (oldId === metadata.imageId) continue
          const old = await inspect(oldId)
          if (owns(old)) await docker(['image', 'rm', oldId], options)
        }
      } catch (error) {
        // Restore the previous owned tag if it still exists. A failed retention
        // never leaves the candidate authorized by a stable validation tag.
        if (previous && (await inspect(previous.Id, true)))
          await docker(['tag', previous.Id, image], cleanupOptions)
        else await discard(metadata)
        throw error
      }
      return { ...metadata, image }
    }
  }
}
