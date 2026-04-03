/**
 * Boundary guard test
 *
 * Ensures that src/shared/ never imports from src/main/.
 * This prevents architecture drift where the shared layer
 * depends on main-process internals.
 */

import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import { resolve } from 'path'

const ROOT = resolve(__dirname, '..', '..', '..')

describe('Shared layer boundary', () => {
  it('src/shared/ has no imports from src/main/', () => {
    try {
      const result = execSync(
        `grep -r "from '.*main/" --include="*.ts" "${resolve(ROOT, 'src/shared/')}"`,
        { encoding: 'utf-8' }
      )
      // If grep finds matches, it returns them — fail the test
      expect.fail(`Found shared→main imports:\n${result}`)
    } catch (e: unknown) {
      // grep exits with code 1 when no matches found — that's success
      const err = e as { status?: number }
      expect(err.status).toBe(1)
    }
  })
})
