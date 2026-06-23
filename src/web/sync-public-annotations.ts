import { createHash } from 'node:crypto'
import { createReadStream, readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { Pool, type PoolClient } from 'pg'

import {
  type AnnotationBundleFile,
  type AnnotationBundleManifest,
  validateAnnotationBundleManifest
} from '../shared/annotations/annotation-bundle'
import {
  type PublicAnnotationSnapshotManifest,
  validatePublicAnnotationSnapshotManifest
} from '../shared/annotations/public-snapshot'
import { buildPostgresPoolConfig, getPostgresStorageConfig } from '../main/storage/config'
import {
  buildPublicVariantRecordSources,
  extractPublicVariantRecords,
  type PublicVariantRecordPayload,
  type PublicVariantRecordSource
} from './public-annotation-bundle-records'

interface SnapshotPayload {
  snapshotId: string
  bundleId: string | null
  genomeBuild: string | null
  mappingVersion: string
  contentHash: string
  manifestChecksum: string
  licenseMatrixChecksum: string
}

interface FilePayload {
  role: string
  path: string
  checksum: string | null
  sizeBytes: number | null
  indexPath: string | null
  indexChecksum: string | null
  indexSizeBytes: number | null
  required: boolean
  formatVersion: string | null
}

export interface PublicAnnotationSyncPayload {
  schemaVersion: 'varlens.annotation-bundle.v1' | 'varlens.public-annotation-snapshot.v1'
  sourceManifestPath: string
  sourceManifestChecksum: string
  privateCaseData: boolean
  snapshot: SnapshotPayload
  files: FilePayload[]
  variantRecordSources: PublicVariantRecordSource[]
  storedManifest: unknown
}

export interface PublicAnnotationSyncResult {
  variantRecordCount: number
}

type QueryableClient = Pick<PoolClient, 'query' | 'release'>
type TransactionPool = { connect: () => Promise<QueryableClient> }

const SELF_REFERENTIAL_MANIFEST_CHECKSUM = `sha256:${'0'.repeat(64)}`

function readArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

function resolvePublicAnnotationWriteUrl(env: NodeJS.ProcessEnv = process.env): string {
  const publicUrl = env.VARLENS_PUBLIC_ANNOTATION_WRITE_PG_URL?.trim()
  const fallbackUrl = env.VARLENS_PG_URL?.trim()
  const url = publicUrl !== undefined && publicUrl !== '' ? publicUrl : fallbackUrl
  if (url === undefined || url === '') {
    throw new Error('VARLENS_PUBLIC_ANNOTATION_WRITE_PG_URL or VARLENS_PG_URL is required')
  }
  return url
}

function redactedManifestForPublicDb(manifest: AnnotationBundleManifest): Record<string, unknown> {
  return {
    ...manifest,
    files: {
      redacted: true,
      reason:
        'privacy.privateCaseData is true; private bundle file inventory is not stored in the public annotation DB',
      count: manifest.files.length
    }
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolvePromise)
  })
  return `sha256:${hash.digest('hex')}`
}

function resolveManifestFile(manifestDir: string, relativePath: string): string {
  const absolutePath = isAbsolute(relativePath) ? relativePath : join(manifestDir, relativePath)
  const resolvedManifestDir = resolve(manifestDir)
  const resolvedPath = resolve(absolutePath)
  if (!resolvedPath.startsWith(`${resolvedManifestDir}/`) && resolvedPath !== resolvedManifestDir) {
    throw new Error(`manifest file escapes bundle root: ${relativePath}`)
  }
  return resolvedPath
}

async function verifyBundleFile(manifestDir: string, file: AnnotationBundleFile): Promise<void> {
  if (file.role === 'manifest' && file.checksum === SELF_REFERENTIAL_MANIFEST_CHECKSUM) {
    return
  }
  await verifyOneBundlePath(manifestDir, file.path, file.checksum, file.sizeBytes)
  if (file.indexPath !== undefined) {
    await verifyOneBundlePath(manifestDir, file.indexPath, file.indexChecksum, file.indexSizeBytes)
  }
}

async function verifyOneBundlePath(
  manifestDir: string,
  relativePath: string,
  expectedChecksum: string | undefined,
  expectedSizeBytes: number | undefined
): Promise<void> {
  if (expectedChecksum === undefined || expectedSizeBytes === undefined) {
    throw new Error(`${relativePath}: missing checksum or size`)
  }
  const absolutePath = resolveManifestFile(manifestDir, relativePath)
  const actualStat = await stat(absolutePath)
  if (actualStat.size !== expectedSizeBytes) {
    throw new Error(`${relativePath}: size mismatch`)
  }
  if ((await sha256File(absolutePath)) !== expectedChecksum) {
    throw new Error(`${relativePath}: checksum mismatch`)
  }
}

export async function buildPublicAnnotationSyncPayload(
  manifestPath: string
): Promise<PublicAnnotationSyncPayload> {
  const absoluteManifestPath = resolve(manifestPath)
  const manifestInput = JSON.parse(readFileSync(absoluteManifestPath, 'utf8')) as unknown
  const sourceManifestChecksum = await sha256File(absoluteManifestPath)

  const bundleResult = validateAnnotationBundleManifest(manifestInput)
  if (bundleResult.ok && bundleResult.manifest !== undefined) {
    const manifest = bundleResult.manifest
    const manifestDir = dirname(absoluteManifestPath)
    for (const file of manifest.files) {
      await verifyBundleFile(manifestDir, file)
    }
    return {
      schemaVersion: 'varlens.annotation-bundle.v1',
      sourceManifestPath: absoluteManifestPath,
      sourceManifestChecksum,
      privateCaseData: true,
      snapshot: {
        snapshotId: manifest.publicSnapshot.snapshotId,
        bundleId: manifest.bundleId,
        genomeBuild: manifest.genomeBuild,
        mappingVersion: manifest.publicSnapshot.mappingVersion,
        contentHash: manifest.publicSnapshot.contentHash,
        manifestChecksum: manifest.publicSnapshot.manifestChecksum,
        licenseMatrixChecksum: manifest.publicSnapshot.licenseMatrixChecksum
      },
      files: [],
      variantRecordSources: buildPublicVariantRecordSources(manifest, (file) =>
        resolveManifestFile(manifestDir, file.path)
      ),
      storedManifest: redactedManifestForPublicDb(manifest)
    }
  }

  const publicResult = validatePublicAnnotationSnapshotManifest(manifestInput)
  if (publicResult.ok && publicResult.manifest !== undefined) {
    const manifest: PublicAnnotationSnapshotManifest = publicResult.manifest
    return {
      schemaVersion: 'varlens.public-annotation-snapshot.v1',
      sourceManifestPath: absoluteManifestPath,
      sourceManifestChecksum,
      privateCaseData: false,
      snapshot: {
        snapshotId: manifest.snapshotId,
        bundleId: null,
        genomeBuild: manifest.genomeBuild,
        mappingVersion: manifest.mappingVersion,
        contentHash: manifest.contentHash,
        manifestChecksum: manifest.manifestChecksum,
        licenseMatrixChecksum: manifest.licenseMatrix.matrixChecksum
      },
      files: [],
      variantRecordSources: [],
      storedManifest: manifest
    }
  }

  throw new Error(
    [
      'Invalid public annotation sync manifest.',
      ...bundleResult.errors.map((error) => `bundle: ${error}`),
      ...publicResult.errors.map((error) => `publicSnapshot: ${error}`)
    ].join(' ')
  )
}

export async function syncPublicAnnotationPayload(
  pool: TransactionPool,
  payload: PublicAnnotationSyncPayload
): Promise<PublicAnnotationSyncResult> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`
      CREATE TABLE IF NOT EXISTS public_annotation_snapshots (
        snapshot_id text PRIMARY KEY,
        schema_version text NOT NULL,
        bundle_id text,
        genome_build text,
        mapping_version text NOT NULL,
        content_hash text NOT NULL,
        manifest_checksum text NOT NULL,
        license_matrix_checksum text NOT NULL,
        source_manifest_checksum text NOT NULL,
        private_case_data boolean NOT NULL DEFAULT false,
        stored_manifest_json jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        ingested_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS public_annotation_files (
        snapshot_id text NOT NULL REFERENCES public_annotation_snapshots(snapshot_id) ON DELETE CASCADE,
        role text NOT NULL,
        path text NOT NULL,
        checksum text,
        size_bytes bigint,
        index_path text,
        index_checksum text,
        index_size_bytes bigint,
        required boolean NOT NULL DEFAULT true,
        format_version text,
        PRIMARY KEY (snapshot_id, role, path)
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS public_annotation_sync_events (
        event_id bigserial PRIMARY KEY,
        snapshot_id text NOT NULL REFERENCES public_annotation_snapshots(snapshot_id) ON DELETE CASCADE,
        source_manifest_checksum text NOT NULL,
        public_file_count integer NOT NULL,
        private_case_data boolean NOT NULL,
        synced_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS public_annotation_variant_records (
        snapshot_id text NOT NULL REFERENCES public_annotation_snapshots(snapshot_id) ON DELETE CASCADE,
        chr text NOT NULL,
        pos bigint NOT NULL,
        ref text NOT NULL,
        alt text NOT NULL,
        source_id text NOT NULL,
        field_name text NOT NULL,
        field_value jsonb NOT NULL,
        evidence_json jsonb NOT NULL,
        provenance_json jsonb NOT NULL,
        PRIMARY KEY (snapshot_id, chr, pos, ref, alt, source_id, field_name)
      )
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS public_annotation_variant_records_lookup_idx
      ON public_annotation_variant_records (chr, pos, ref, alt)
    `)

    const existing = await client.query<{
      content_hash: string
      manifest_checksum: string
      license_matrix_checksum: string
    }>(
      `
        SELECT content_hash, manifest_checksum, license_matrix_checksum
        FROM public_annotation_snapshots
        WHERE snapshot_id = $1
        LIMIT 1
      `,
      [payload.snapshot.snapshotId]
    )
    const row = existing.rows[0]
    if (
      row !== undefined &&
      (row.content_hash !== payload.snapshot.contentHash ||
        row.manifest_checksum !== payload.snapshot.manifestChecksum ||
        row.license_matrix_checksum !== payload.snapshot.licenseMatrixChecksum)
    ) {
      throw new Error(
        `public annotation snapshot ${payload.snapshot.snapshotId} already exists with different immutable checksums`
      )
    }

    await client.query(
      `
        INSERT INTO public_annotation_snapshots (
          snapshot_id,
          schema_version,
          bundle_id,
          genome_build,
          mapping_version,
          content_hash,
          manifest_checksum,
          license_matrix_checksum,
          source_manifest_checksum,
          private_case_data,
          stored_manifest_json
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
        ON CONFLICT (snapshot_id) DO NOTHING
      `,
      [
        payload.snapshot.snapshotId,
        payload.schemaVersion,
        payload.snapshot.bundleId,
        payload.snapshot.genomeBuild,
        payload.snapshot.mappingVersion,
        payload.snapshot.contentHash,
        payload.snapshot.manifestChecksum,
        payload.snapshot.licenseMatrixChecksum,
        payload.sourceManifestChecksum,
        payload.privateCaseData,
        JSON.stringify(payload.storedManifest)
      ]
    )

    await client.query('DELETE FROM public_annotation_files WHERE snapshot_id = $1', [
      payload.snapshot.snapshotId
    ])
    await client.query('DELETE FROM public_annotation_variant_records WHERE snapshot_id = $1', [
      payload.snapshot.snapshotId
    ])
    for (const file of payload.files) {
      await client.query(
        `
          INSERT INTO public_annotation_files (
            snapshot_id,
            role,
            path,
            checksum,
            size_bytes,
            index_path,
            index_checksum,
            index_size_bytes,
            required,
            format_version
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `,
        [
          payload.snapshot.snapshotId,
          file.role,
          file.path,
          file.checksum,
          file.sizeBytes,
          file.indexPath,
          file.indexChecksum,
          file.indexSizeBytes,
          file.required,
          file.formatVersion
        ]
      )
    }
    const variantRecordCount = await syncVariantRecords(client, payload)
    await client.query(
      `
        INSERT INTO public_annotation_sync_events (
          snapshot_id,
          source_manifest_checksum,
          public_file_count,
          private_case_data
        ) VALUES ($1,$2,$3,$4)
      `,
      [
        payload.snapshot.snapshotId,
        payload.sourceManifestChecksum,
        payload.files.length,
        payload.privateCaseData
      ]
    )
    await client.query('COMMIT')
    return { variantRecordCount }
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Preserve the original sync error.
    }
    throw error
  } finally {
    client.release()
  }
}

async function syncVariantRecords(
  client: QueryableClient,
  payload: PublicAnnotationSyncPayload
): Promise<number> {
  let count = 0
  let batch: PublicVariantRecordPayload[] = []
  for (const source of payload.variantRecordSources) {
    for await (const record of extractPublicVariantRecords(source, {
      bundleId: payload.snapshot.bundleId ?? payload.snapshot.snapshotId,
      publicSnapshotId: payload.snapshot.snapshotId,
      mappingVersion: payload.snapshot.mappingVersion
    })) {
      batch.push(record)
      if (batch.length >= 500) {
        await insertVariantRecordBatch(client, payload.snapshot.snapshotId, batch)
        count += batch.length
        batch = []
      }
    }
  }
  if (batch.length > 0) {
    await insertVariantRecordBatch(client, payload.snapshot.snapshotId, batch)
    count += batch.length
  }
  return count
}

async function insertVariantRecordBatch(
  client: QueryableClient,
  snapshotId: string,
  records: readonly PublicVariantRecordPayload[]
): Promise<void> {
  const values: unknown[] = []
  const rows = records.map((record, index) => {
    const offset = index * 10
    values.push(
      snapshotId,
      record.chr,
      record.pos,
      record.ref,
      record.alt,
      record.sourceId,
      record.fieldName,
      JSON.stringify(record.fieldValue),
      JSON.stringify(record.evidence),
      JSON.stringify(record.provenance)
    )
    return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8}::jsonb,$${offset + 9}::jsonb,$${offset + 10}::jsonb)`
  })

  await client.query(
    `
      INSERT INTO public_annotation_variant_records (
        snapshot_id,
        chr,
        pos,
        ref,
        alt,
        source_id,
        field_name,
        field_value,
        evidence_json,
        provenance_json
      ) VALUES ${rows.join(',')}
      ON CONFLICT (snapshot_id, chr, pos, ref, alt, source_id, field_name) DO UPDATE SET
        field_value = EXCLUDED.field_value,
        evidence_json = EXCLUDED.evidence_json,
        provenance_json = EXCLUDED.provenance_json
    `,
    values
  )
}

async function main(): Promise<void> {
  const manifestPath = readArg(process.argv.slice(2), '--manifest')
  if (manifestPath === undefined || manifestPath.trim() === '') {
    throw new Error('--manifest is required')
  }
  const url = resolvePublicAnnotationWriteUrl()
  const config = getPostgresStorageConfig({
    ...process.env,
    VARLENS_PG_URL: url,
    VARLENS_PG_SCHEMA: 'public',
    VARLENS_PG_APPLICATION_NAME: 'varlens-public-annotation-sync',
    VARLENS_PG_POOL_MAX: '1'
  })
  if (config === null) {
    throw new Error('public annotation PostgreSQL config could not be built')
  }

  const payload = await buildPublicAnnotationSyncPayload(manifestPath)
  const pool = new Pool(buildPostgresPoolConfig(config))
  try {
    const result = await syncPublicAnnotationPayload(pool, payload)
    process.stdout.write(
      JSON.stringify({
        ok: true,
        snapshotId: payload.snapshot.snapshotId,
        schemaVersion: payload.schemaVersion,
        publicFileCount: payload.files.length,
        publicVariantRecordCount: result.variantRecordCount,
        privateCaseDataRedacted: payload.privateCaseData
      }) + '\n'
    )
  } finally {
    await pool.end()
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
