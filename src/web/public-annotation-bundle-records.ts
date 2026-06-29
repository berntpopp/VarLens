import { createReadStream } from 'node:fs'
import { open } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'

import type {
  AnnotationBundleFile,
  AnnotationBundleManifest
} from '../shared/annotations/annotation-bundle'
import {
  extractCsqFieldsFromHeaderLine,
  selectBestCsqTranscriptForAllele
} from '../shared/vcf/vcf-csq'
import { parseVcfInfo } from '../shared/vcf/vcf-info'

export interface PublicVariantRecordSource {
  role: AnnotationBundleFile['role']
  absolutePath: string
}

export interface PublicVariantRecordPayload {
  chr: string
  pos: number
  ref: string
  alt: string
  sourceId: string
  fieldName: string
  fieldValue: string
  evidence: Record<string, unknown>
  provenance: Record<string, unknown>
}

export interface PublicVariantRecordContext {
  bundleId: string
  publicSnapshotId: string
  mappingVersion: string
}

interface FieldMapping {
  csqField: string
  sourceId: string
  fieldName: string
}

const PUBLIC_SAFE_CSQ_FIELDS: readonly FieldMapping[] = [
  { csqField: 'Consequence', sourceId: 'vep', fieldName: 'consequence' },
  { csqField: 'IMPACT', sourceId: 'vep', fieldName: 'impact' },
  { csqField: 'SYMBOL', sourceId: 'vep', fieldName: 'gene_symbol' },
  { csqField: 'Gene', sourceId: 'vep', fieldName: 'gene_id' },
  { csqField: 'Feature', sourceId: 'vep', fieldName: 'transcript_id' },
  { csqField: 'HGVSc', sourceId: 'vep', fieldName: 'hgvsc' },
  { csqField: 'HGVSp', sourceId: 'vep', fieldName: 'hgvsp' },
  {
    csqField: 'ClinVarCurrent_CLNSIG',
    sourceId: 'clinvar_current',
    fieldName: 'clinical_significance'
  },
  {
    csqField: 'ClinVarCurrent_CLNREVSTAT',
    sourceId: 'clinvar_current',
    fieldName: 'review_status'
  },
  { csqField: 'ClinVarCurrent_CLNDN', sourceId: 'clinvar_current', fieldName: 'condition' },
  { csqField: 'ClinVarCurrent_ALLELEID', sourceId: 'clinvar_current', fieldName: 'allele_id' }
] as const
const VCF_SOURCE_ROLES = new Set<AnnotationBundleFile['role']>([
  'snv_vcf',
  'sv_vcf',
  'cnv_vcf',
  'str_vcf'
])

export function buildPublicVariantRecordSources(
  manifest: AnnotationBundleManifest,
  resolveFilePath: (file: AnnotationBundleFile) => string
): PublicVariantRecordSource[] {
  return manifest.files
    .filter((file) => VCF_SOURCE_ROLES.has(file.role))
    .map((file) => ({
      role: file.role,
      absolutePath: resolveFilePath(file)
    }))
}

export async function* extractPublicVariantRecords(
  source: PublicVariantRecordSource,
  context: PublicVariantRecordContext
): AsyncGenerator<PublicVariantRecordPayload> {
  let csqFields: string[] = []
  for await (const line of readVcfLines(source.absolutePath)) {
    if (line.startsWith('##')) {
      const headerFields = extractCsqFieldsFromHeaderLine(line)
      if (headerFields !== null) csqFields = headerFields
      continue
    }
    if (line.startsWith('#') || line.trim() === '') continue

    const columns = line.split('\t')
    if (columns.length < 8) continue

    const [chr, posValue, , ref, altValue, , , infoValue] = columns
    const pos = Number(posValue)
    if (!Number.isSafeInteger(pos) || !isSupportedAlt(altValue)) continue

    const csq = selectBestCsqTranscriptForAllele(
      parseVcfInfo(infoValue).get('CSQ'),
      csqFields,
      altValue,
      ref
    )
    if (csq === null) continue

    for (const mapping of PUBLIC_SAFE_CSQ_FIELDS) {
      const value = csq.fields.get(mapping.csqField)
      if (!hasPublicValue(value)) continue

      yield {
        chr,
        pos,
        ref,
        alt: altValue,
        sourceId: mapping.sourceId,
        fieldName: mapping.fieldName,
        fieldValue: value,
        evidence: {
          allele: csq.allele || altValue,
          csqField: mapping.csqField,
          sourceRole: source.role
        },
        provenance: {
          bundleId: context.bundleId,
          publicSnapshotId: context.publicSnapshotId,
          mappingVersion: context.mappingVersion,
          sourceRole: source.role
        }
      }
    }
  }
}

async function* readVcfLines(path: string): AsyncGenerator<string> {
  const fileStream = createReadStream(path)
  const input = (await isGzipFile(path)) ? fileStream.pipe(createGunzip()) : fileStream
  const lines = createInterface({ input, crlfDelay: Infinity })
  for await (const line of lines) {
    yield line
  }
}

async function isGzipFile(path: string): Promise<boolean> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(2)
    const { bytesRead } = await handle.read(buffer, 0, 2, 0)
    return bytesRead === 2 && buffer[0] === 0x1f && buffer[1] === 0x8b
  } finally {
    await handle.close()
  }
}

function hasPublicValue(value: string | undefined): value is string {
  return value !== undefined && value !== '' && value !== '.'
}

function isSupportedAlt(alt: string): boolean {
  return alt !== '' && !alt.includes(',') && alt !== '*'
}
