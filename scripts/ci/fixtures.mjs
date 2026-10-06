import { GENERATED_FIXTURES, assertSameSource, snapshotSource } from './receipt.mjs'

// The default offline flow of `make web-data-verify`: verify tracked sources,
// regenerate, then verify every output against its pinned checksum.
const STEPS = ['download-fixtures', 'prepare-fixtures', 'verify-fixtures']

/**
 * Generated fixtures are ignored files which the web-gate tests regenerate. A
 * fresh worktree has none, so a snapshot taken before the first stage could
 * never equal the one taken after it. Materialize them first and return the
 * snapshot that binds their bytes; everything else must equal `initial`.
 */
export async function materializeFixtures({ cwd, execute, initial }) {
  for (const step of STEPS)
    await execute(process.execPath, [`scripts/data-fixtures/${step}.mjs`], { quiet: true })
  const ready = snapshotSource(cwd)
  assertSameSource(initial, ready)
  const present = new Set(ready.generatedFixtures.map(([path]) => path))
  const missing = GENERATED_FIXTURES.filter((path) => !present.has(path))
  if (missing.length)
    throw new Error(
      `Generated fixtures are missing after preparation: ${missing.join(', ')}. Align scripts/data-fixtures/sources.json with the receipt's fixture inventory.`
    )
  return ready
}
