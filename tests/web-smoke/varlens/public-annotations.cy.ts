import { beforeEachAuthenticatedSmoke } from '../support/auth'

interface PublicAnnotationBatchResult {
  variantRecords?: Array<Record<string, unknown>>
  publicReferences?: {
    snapshots?: Array<Record<string, unknown>>
    variantRecords?: Array<Record<string, unknown>>
  }
}

describe('VarLens public annotation lookup smoke', () => {
  beforeEachAuthenticatedSmoke()

  it('serves synced public annotation records to the hosted app user', () => {
    cy.varlensApi('auth', 'currentUser').then((response) => {
      expect(response.status, 'current user HTTP status').to.eq(200)
      const user = response.body as { role?: string }
      expect(user.role, 'public lookup smoke user must not be admin').to.not.eq('admin')
    })

    cy.varlensApi('annotations', 'batchGet', [
      null,
      [{ chr: 'chr21', pos: 10, ref: 'A', alt: 'G' }]
    ]).then((response) => {
      expect(response.status, 'annotations:batchGet HTTP status').to.eq(200)
      const body = response.body as Record<string, PublicAnnotationBatchResult>
      const record = body['chr21:10:A:G']
      expect(record, 'public annotation batch record').to.not.eq(undefined)

      const variantRecords = record.publicReferences?.variantRecords ?? record.variantRecords ?? []
      expect(variantRecords.length, 'public annotation variant records').to.be.greaterThan(0)

      const flattenedRecordText = JSON.stringify(variantRecords)
      expect(
        /Pathogenic|GENE1|ClinVar/i.test(flattenedRecordText),
        'synced ClinVar/dbNSFP public annotation evidence'
      ).to.eq(true)
    })
  })
})
