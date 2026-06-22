import { readFileSync } from 'node:fs'

import { getPostgresStorageConfig } from '../main/storage/config'
import { createPostgresStorageSession } from '../main/storage/postgres/createPostgresStorageSession'
import { PostgresWebAuthService } from './auth/PostgresWebAuthService'

interface Options {
  username: string
  displayName: string
  createdBy: string
  credential: { kind: 'hash'; value: string } | { kind: 'password'; value: string }
  privateDbSecretRef?: string
  publicAnnotationSnapshotId?: string
}

function readArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

function readCredential(args: string[]): Options['credential'] {
  const inline = readArg(args, '--password-hash')
  const file = readArg(args, '--password-hash-file')
  const password = readArg(args, '--password')
  const passwordFile = readArg(args, '--password-file')
  const provided = [inline, file, password, passwordFile].filter((value) => value !== undefined)
  if (provided.length !== 1) {
    throw new Error(
      'Provide exactly one of --password-hash, --password-hash-file, --password, or --password-file'
    )
  }
  if (inline !== undefined) return { kind: 'hash', value: inline.trim() }
  if (file !== undefined) return { kind: 'hash', value: readFileSync(file, 'utf8').trim() }
  if (password !== undefined) return { kind: 'password', value: password }
  return { kind: 'password', value: readFileSync(passwordFile as string, 'utf8').trim() }
}

function parseOptions(args: string[]): Options {
  const username = readArg(args, '--username')?.trim()
  const displayName = readArg(args, '--display-name')?.trim()
  const createdBy = readArg(args, '--created-by')?.trim() ?? 'admin'
  const privateDbSecretRef = readArg(args, '--private-db-secret-ref')?.trim()
  const publicAnnotationSnapshotId = readArg(args, '--public-annotation-snapshot-id')?.trim()
  const credential = readCredential(args)

  if (username === undefined || username === '') {
    throw new Error('--username is required')
  }
  if (displayName === undefined || displayName === '') {
    throw new Error('--display-name is required')
  }
  if (createdBy === '') {
    throw new Error('--created-by must not be blank')
  }
  if (credential.value === '') {
    throw new Error(`${credential.kind} must not be blank`)
  }

  if (privateDbSecretRef === '') {
    throw new Error('--private-db-secret-ref must not be blank when provided')
  }
  if (publicAnnotationSnapshotId === '') {
    throw new Error('--public-annotation-snapshot-id must not be blank when provided')
  }

  return {
    username,
    displayName,
    createdBy,
    credential,
    ...(privateDbSecretRef !== undefined ? { privateDbSecretRef } : {}),
    ...(publicAnnotationSnapshotId !== undefined ? { publicAnnotationSnapshotId } : {})
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))
  const config = getPostgresStorageConfig(process.env)
  if (config === null) {
    throw new Error('VARLENS_PG_URL is required')
  }

  const session = await createPostgresStorageSession(config)
  try {
    const auth = new PostgresWebAuthService({
      pool: session.getPool(),
      schema: config.schema
    })
    const result =
      options.credential.kind === 'hash'
        ? await auth.createUserFromHash(
            options.username,
            options.displayName,
            options.credential.value,
            options.createdBy
          )
        : await auth.createUser(
            options.username,
            options.displayName,
            options.credential.value,
            options.createdBy
          )
    if (options.privateDbSecretRef !== undefined) {
      await auth.assignPrivateDatabase(
        options.username,
        options.privateDbSecretRef,
        options.publicAnnotationSnapshotId
      )
    }
    process.stdout.write(
      JSON.stringify({
        ok: true,
        username: result.username,
        role: result.role,
        must_change_password: result.must_change_password === 1,
        private_db_secret_ref: options.privateDbSecretRef ?? null,
        public_annotation_snapshot_id: options.publicAnnotationSnapshotId ?? null
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
