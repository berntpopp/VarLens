import { beforeEachAuthenticatedSmoke } from '../support/auth'
import { expectImportedCaseRendered } from '../support/case-view'
import { importSingleFileCase } from '../support/import-workflows'
import { jsonImportFile, uniqueSmokeName } from '../support/fixtures'

/**
 * Audit-trail browser smoke.
 *
 * Black-box complement to tests/web-gate/integration/audit-trail.test.ts:
 * the deployment under test is single-tenant (auth:createUser is 501), so
 * the non-admin 403 path is covered by the integration test, not here.
 * This spec proves what only a browser can: the audit API surface behaves
 * for an unauthenticated client. The admin-only audit API checks run only
 * when the configured smoke account is an admin, so the release gate can use
 * the same browser smoke suite with a normal user.
 */

interface AuditEntry {
  action_type: string
  entity_key: string
  user_name: string | null
}

describe('VarLens audit trail public surface', () => {
  it('rejects unauthenticated audit reads', () => {
    cy.clearCookies()
    cy.varlensApi('audit', 'query', [{ limit: 5 }]).then((response) => {
      expect(response.status, 'unauthenticated audit:query').to.eq(401)
    })
  })
})

describe('VarLens audit activity smoke', () => {
  beforeEachAuthenticatedSmoke()

  it('records admin API activity and serves it back over the audit API', () => {
    cy.varlensApi('auth', 'currentUser').then((currentUserResponse) => {
      expect(currentUserResponse.status, 'current user HTTP status').to.eq(200)
      const currentUser = currentUserResponse.body as { role?: string }
      if (currentUser.role !== 'admin') {
        cy.log('Skipping admin audit query smoke for non-admin release user')
        return
      }

      // Any audited read works as the trigger; cases:list is the lightest.
      cy.varlensApi('cases', 'list').then((response) => {
        expect(response.status, 'audited read').to.eq(200)
      })

      cy.varlensApi('audit', 'query', [{ limit: 100 }]).then((response) => {
        expect(response.status, 'admin audit:query').to.eq(200)
        const body = response.body as { data: AuditEntry[]; total_count: number }
        expect(body.total_count, 'audit trail row count').to.be.greaterThan(0)

        const username = Cypress.env('varlensUsername') as string
        const ownReads = body.data.filter(
          (entry) => entry.action_type === 'api_read' && entry.user_name === username
        )
        expect(ownReads.length, `api_read entries attributed to ${username}`).to.be.greaterThan(0)
      })
    })
  })

  it('shows an annotation action in the variant Activity Log panel', () => {
    cy.varlensApi('auth', 'currentUser').then((currentUserResponse) => {
      expect(currentUserResponse.status, 'current user HTTP status').to.eq(200)
      const currentUser = currentUserResponse.body as { role?: string }
      if (currentUser.role !== 'admin') {
        cy.log('Skipping admin Activity Log smoke for non-admin release user')
        return
      }

      const caseName = uniqueSmokeName('audit-activity')
      importSingleFileCase(caseName, jsonImportFile(`${caseName}.json`, 'AUDITSMOKE'))

      // Star the imported variant per-case — an audited annotation write whose
      // trail entry the Activity Log panel (case mode keys the trail as
      // case:<caseId>:variant:<variantId>) renders as "Starred".
      cy.varlensApi('cases', 'query', [{ limit: 20, offset: 0, search_term: caseName }])
        .then((casesResponse) => {
          expect(casesResponse.status, 'cases:query').to.eq(200)
          const cases = (casesResponse.body as { data: Array<{ id: number; name: string }> }).data
          const importedCase = cases.find((item) => item.name === caseName)
          expect(importedCase, `imported case ${caseName}`).to.not.eq(undefined)
          return cy
            .varlensApi('variants', 'query', [importedCase!.id, {}])
            .then((variantsResponse) => {
              expect(variantsResponse.status, 'variants:query').to.eq(200)
              const variants = (variantsResponse.body as { data: Array<{ id: number }> }).data
              expect(variants.length, 'imported variants').to.be.greaterThan(0)
              return { caseId: importedCase!.id, variantId: variants[0].id }
            })
        })
        .then(({ caseId, variantId }) => {
          cy.varlensApi('annotations', 'upsertPerCase', [
            caseId,
            variantId,
            { starred: true }
          ]).then((response) => {
            expect(response.status, 'audited annotation write').to.eq(200)
          })
          cy.varlensApi('audit', 'getByEntity', [`case:${caseId}:variant:${variantId}`]).then(
            (response) => {
              expect(response.status, 'admin audit:getByEntity').to.eq(200)
              const entries = response.body as AuditEntry[]
              expect(
                entries.some((entry) => entry.action_type === 'star'),
                'star entry in trail before opening the UI'
              ).to.eq(true)
            }
          )
        })

      expectImportedCaseRendered(caseName, [['AUDITSMOKE', /12,?345/]])

      cy.contains('.v-data-table tbody tr, table tbody tr', 'AUDITSMOKE', { timeout: 30000 })
        .first()
        .click({ force: true })

      // The Activity Log section sits below the fold of the scrollable
      // details drawer — scroll it into view before asserting visibility.
      cy.contains('.v-expansion-panel-title', /Activity Log/i, { timeout: 15000 })
        .scrollIntoView()
        .should('be.visible')
        .click({ force: true })

      cy.get('.activity-log-panel', { timeout: 15000 })
        .scrollIntoView()
        .should('be.visible')
        .within(() => {
          cy.contains(/Starred/i, { timeout: 15000 }).should('be.visible')
        })
    })
  })
})
