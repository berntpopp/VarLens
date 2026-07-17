import { getPostgresStorageConfig } from '../main/storage/config'
import { createPostgresStorageSession } from '../main/storage/postgres/createPostgresStorageSession'
import { ROLE_ADMIN, ROLE_USER, type UserRole } from '../shared/auth/auth-constants'
import { PostgresPlatformUserStore } from './auth/PostgresPlatformUserStore'

interface Options {
  subject: string
  displayName: string
  role: UserRole
}

const VALUE_ARGS = new Set(['--subject', '--display-name', '--role'])

function readArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

function assertKnownArgs(args: string[]): void {
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    if (!VALUE_ARGS.has(name)) {
      throw new Error(`Unknown argument: ${name}`)
    }
    if (args[index + 1] === undefined) {
      throw new Error(`${name} requires a value`)
    }
  }
}

export function parseOptions(args: string[]): Options {
  assertKnownArgs(args)
  const subject = readArg(args, '--subject')?.trim()
  const displayName = readArg(args, '--display-name')?.trim()
  const role = readArg(args, '--role')?.trim() ?? ROLE_USER

  if (subject === undefined || subject === '') {
    throw new Error('--subject is required')
  }
  if (displayName === undefined || displayName === '') {
    throw new Error('--display-name is required')
  }
  if (role !== ROLE_USER && role !== ROLE_ADMIN) {
    throw new Error('--role must be either user or admin')
  }

  return { subject, displayName, role }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))
  const config = getPostgresStorageConfig(process.env)
  if (config === null) {
    throw new Error('VARLENS_PG_URL is required')
  }

  const session = await createPostgresStorageSession(config)
  try {
    const users = new PostgresPlatformUserStore(session.getPool(), config.schema)
    const result = await users.upsert({
      subject: options.subject,
      displayName: options.displayName,
      role: options.role
    })
    process.stdout.write(
      JSON.stringify({ ok: true, subject: result.subject, role: result.role }) + '\n'
    )
  } finally {
    await session.close()
  }
}

declare const require: NodeJS.Require
declare const module: NodeJS.Module
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(JSON.stringify({ ok: false, error: message }) + '\n')
    process.exit(1)
  })
}
