import { beforeEachAuthenticatedSmoke } from '../support/auth'
import { queryImportedCase } from '../support/case-view'
import { importSingleVcfCase } from '../support/import-workflows'
import { uniqueSmokeName } from '../support/fixtures'

const publicReferenceVcfPath = 'tests/web-smoke/fixtures/varlens/public-reference-match.vcf'
const referenceVariant = { chr: 'chr1', pos: 976215, ref: 'A', alt: 'G' }
const referenceVariantKey = `${referenceVariant.chr}:${referenceVariant.pos}:${referenceVariant.ref}:${referenceVariant.alt}`

interface PublicAnnotationVariantRecord {
  snapshotId: string
  sourceId: string | null
  fieldName: string
  fieldValue: unknown
}

interface VariantAnnotationResult {
  publicReferences?: {
    snapshots: Array<{ snapshotId: string }>
    variantRecords: PublicAnnotationVariantRecord[]
  }
}

function normalizedFieldValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function expectPublicReferenceField(
  records: PublicAnnotationVariantRecord[],
  fieldName: string,
  expectedValue: string
): void {
  const values = records
    .filter((record) => record.fieldName === fieldName)
    .map((record) => normalizedFieldValue(record.fieldValue))

  expect(values, `public reference field ${fieldName}`).to.include(expectedValue)
}

describe('VarLens public reference lookup smoke', () => {
  beforeEachAuthenticatedSmoke()

  it('imports a matching VCF variant and resolves shared reference annotations for it', () => {
    const caseName = uniqueSmokeName('public-reference')

    importSingleVcfCase(caseName, publicReferenceVcfPath)

    queryImportedCase(caseName).then((importedCase) => {
      cy.varlensApi('annotations', 'batchGet', [importedCase.id, [referenceVariant]]).then(
        (response) => {
          expect(response.status, 'annotations:batchGet').to.eq(200)

          const body = response.body as Record<string, VariantAnnotationResult>
          const references = body[referenceVariantKey]?.publicReferences

          expect(
            references?.snapshots ?? [],
            'shared annotation snapshots visible to the uploaded case'
          ).to.have.length.greaterThan(0)
          expect(
            references?.variantRecords ?? [],
            `shared annotation records for ${referenceVariantKey}`
          ).to.have.length.greaterThan(0)

          const records = references?.variantRecords ?? []
          expectPublicReferenceField(records, 'gene_symbol', 'PERM1')
          expectPublicReferenceField(records, 'consequence', 'missense_variant')
          expectPublicReferenceField(records, 'impact', 'MODERATE')
          expectPublicReferenceField(records, 'clinical_significance', 'Benign')
        }
      )
    })
  })
})
