import { beforeEachAuthenticatedSmoke } from '../support/auth'
import { queryImportedCase } from '../support/case-view'
import { importSingleFileCase } from '../support/import-workflows'
import { jsonImportFile, uniqueSmokeName } from '../support/fixtures'

interface CurrentUser {
  username: string
  role?: string
}

describe('VarLens hosted user isolation smoke', () => {
  beforeEachAuthenticatedSmoke()

  it('lets a normal primary user import data and keeps it hidden from a second normal user', () => {
    const secondaryUsername = Cypress.env('varlensSecondaryUsername') as string
    const secondaryPassword = Cypress.env('varlensSecondaryPassword') as string
    const secondaryRotatedPassword = Cypress.env('varlensSecondaryRotatedPassword') as
      | string
      | undefined

    if (secondaryUsername === '' || secondaryPassword === '') {
      throw new Error(
        'VARLENS_SECONDARY_USERNAME and VARLENS_SECONDARY_PASSWORD are required for user isolation smoke.'
      )
    }

    cy.varlensApi('auth', 'currentUser').then((response) => {
      expect(response.status, 'primary current user HTTP status').to.eq(200)
      const user = response.body as CurrentUser
      expect(user.username, 'primary smoke username').to.eq(Cypress.env('varlensUsername'))
      expect(user.role, 'primary smoke user must not be admin').to.not.eq('admin')
    })

    const caseName = uniqueSmokeName('user-isolation')
    importSingleFileCase(caseName, jsonImportFile(`${caseName}.json`, 'ISOLATIONSMOKE'))
    queryImportedCase(caseName)

    cy.varlensLoginAs(secondaryUsername, secondaryPassword, secondaryRotatedPassword)
    cy.varlensDismissResearchUseModal()

    cy.varlensApi('auth', 'currentUser').then((response) => {
      expect(response.status, 'secondary current user HTTP status').to.eq(200)
      const user = response.body as CurrentUser
      expect(user.username, 'secondary smoke username').to.eq(secondaryUsername)
      expect(user.role, 'secondary smoke user must not be admin').to.not.eq('admin')
    })

    cy.varlensApi('cases', 'query', [{ limit: 20, offset: 0, search_term: caseName }]).then(
      (response) => {
        expect(response.status, 'secondary cases:query HTTP status').to.eq(200)
        const body = response.body as { data: Array<{ name: string }>; total_count: number }
        expect(body.total_count, 'secondary query must not see primary case').to.eq(0)
        expect(
          body.data.some((item) => item.name === caseName),
          'secondary query result must not contain primary case'
        ).to.eq(false)
      }
    )
  })
})
