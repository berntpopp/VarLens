import { getPostgresStorageConfig } from '../main/storage/config'
import { createPostgresStorageSession } from '../main/storage/postgres/createPostgresStorageSession'

async function main(): Promise<void> {
  const config = getPostgresStorageConfig(process.env)
  if (config === null) {
    throw new Error('VARLENS_PG_URL is required')
  }

  const session = await createPostgresStorageSession(config)
  try {
    process.stdout.write(
      JSON.stringify({
        ok: true,
        schema: config.schema,
        backend: session.capabilities.backend
      }) + '\n'
    )
  } finally {
    await session.close()
  }
}

declare const require: NodeJS.Require
declare const module: NodeJS.Module
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(JSON.stringify({ ok: false, error: message }) + '\n')
    process.exit(1)
  })
}
