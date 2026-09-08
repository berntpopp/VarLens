function isSuccessfulLoginBody(
  body: unknown
): body is { success: true; mustChangePassword?: boolean } {
  return body !== null && typeof body === 'object' && 'success' in body && body.success === true
}

function typeIntoVisibleInput(
  index: number,
  value: string,
  options: Partial<Cypress.TypeOptions> = {}
): void {
  cy.get('input:visible', { timeout: 15000 })
    .eq(index)
    .clear({ force: true })
    .type(value, {
      force: true,
      ...options
    })
}

let resolvedLoginPassword: string | undefined

function passwordCacheKey(username: string): string {
  return `${Cypress.config('baseUrl') ?? ''}|${username}`
}

function configuredRotatedPassword(password: string): string {
  const rotatedPassword = Cypress.env('varlensRotatedPassword') as string | undefined
  return rotatedPassword !== undefined && rotatedPassword !== ''
    ? rotatedPassword
    : `${password}-rotated-2026`
}

function waitForLoginRateLimit(response: Cypress.Response<unknown>): Cypress.Chainable<void> {
  const retryAfterHeader = response.headers['retry-after']
  const retryAfterSeconds = Number(
    Array.isArray(retryAfterHeader) ? retryAfterHeader[0] : retryAfterHeader
  )
  const boundedWaitMs = Number.isFinite(retryAfterSeconds)
    ? Math.min(Math.max(retryAfterSeconds, 1), 65) * 1000
    : 60_000

  return cy.wait(boundedWaitMs, { log: false }).then(() => undefined)
}

function cacheResolvedLoginPassword(key: string, password: string): Cypress.Chainable<string> {
  resolvedLoginPassword = password
  return cy
    .task('varlensSetResolvedLoginPassword', { key, password }, { log: false })
    .then(() => password) as Cypress.Chainable<string>
}

Cypress.Commands.add('varlensResolveLoginPassword', () => {
  const username = Cypress.env('varlensUsername') as string
  const password = Cypress.env('varlensPassword') as string
  const rotatedPassword = configuredRotatedPassword(password)

  if (password === '') {
    throw new Error(
      'VARLENS_PASSWORD or VARLENS_ADMIN_PASSWORD is required for authenticated VarLens checks.'
    )
  }

  if (resolvedLoginPassword !== undefined) {
    return cy.wrap(resolvedLoginPassword, { log: false })
  }

  const cacheKey = passwordCacheKey(username)

  const assertLoggedIn = (
    response: Cypress.Response<unknown>,
    candidatePassword: string
  ): string => {
    expect(response.status, 'login HTTP status').to.eq(200)
    expect(response.body, 'login result').to.have.property('success', true)
    expect(
      response.body,
      'bootstrap password must be rotated before E2E can continue'
    ).to.not.have.property('mustChangePassword', true)
    return candidatePassword
  }

  const tryPassword = (
    candidatePassword: string,
    fallback?: () => Cypress.Chainable<string>,
    retryRateLimit = true
  ): Cypress.Chainable<string> => {
    return cy.varlensApi('auth', 'login', [username, candidatePassword]).then((response) => {
      if (response.status === 429 && retryRateLimit) {
        return waitForLoginRateLimit(response).then(() =>
          tryPassword(candidatePassword, fallback, false)
        )
      }

      if (response.status === 200 && isSuccessfulLoginBody(response.body)) {
        if (response.body.mustChangePassword === true) {
          if (rotatedPassword === candidatePassword) {
            throw new Error(
              'VARLENS_ROTATED_ADMIN_PASSWORD must differ from VARLENS_ADMIN_PASSWORD.'
            )
          }

          return cy
            .varlensApi('auth', 'changePassword', [candidatePassword, rotatedPassword])
            .then((changeResponse) => {
              expect(changeResponse.status, 'password rotation HTTP status').to.eq(200)
              expect(changeResponse.body, 'password rotation result').to.have.property(
                'success',
                true
              )
              return cacheResolvedLoginPassword(cacheKey, rotatedPassword)
            })
        }

        return cacheResolvedLoginPassword(cacheKey, assertLoggedIn(response, candidatePassword))
      }

      if (fallback !== undefined) {
        return fallback()
      }

      throw new Error(`login HTTP status ${response.status}`)
    }) as Cypress.Chainable<string>
  }

  return cy
    .task('varlensGetResolvedLoginPassword', cacheKey, { log: false })
    .then((cachedPassword) => {
      if (typeof cachedPassword === 'string' && cachedPassword !== '') {
        resolvedLoginPassword = cachedPassword
        return cachedPassword
      }

      if (rotatedPassword !== password) {
        return tryPassword(password, () => tryPassword(rotatedPassword))
      }

      return tryPassword(password)
    }) as Cypress.Chainable<string>
})

Cypress.Commands.add('varlensLogin', () => {
  const username = Cypress.env('varlensUsername') as string

  return cy.varlensResolveLoginPassword().then((password) => {
    cy.session(
      ['varlens', username, password],
      () => {
        cy.varlensApi('auth', 'logout')
        cy.clearCookies()
        cy.clearLocalStorage()
        cy.visit('/login')
        cy.contains(/Sign in to continue/i, { timeout: 15000 }).should('be.visible')

        typeIntoVisibleInput(0, username)
        typeIntoVisibleInput(1, password, { log: false })
        cy.contains('button', /Sign in/i, { timeout: 15000 }).click({ force: true })

        cy.get('body', { timeout: 15000 }).then(($body) => {
          if (/Change your password/i.test($body.text())) {
            const rotatedPassword = configuredRotatedPassword(password)
            typeIntoVisibleInput(0, rotatedPassword, { log: false })
            typeIntoVisibleInput(1, rotatedPassword, { log: false })
            cy.contains('button', /^Change Password$/i, { timeout: 15000 }).click({ force: true })
          }
        })

        cy.location('pathname', { timeout: 15000 }).should('not.contain', '/login')
      },
      {
        cacheAcrossSpecs: true,
        validate() {
          cy.varlensApi('auth', 'currentUser').then((response) => {
            expect(response.status, 'session validation HTTP status').to.eq(200)
          })
        }
      }
    )

    cy.visit('/')
    return cy
      .location('pathname', { timeout: 15000 })
      .should('not.contain', '/login')
      .then(() => undefined)
  }) as unknown as Cypress.Chainable<void>
})

export function beforeEachAuthenticatedSmoke(): void {
  beforeEach(function () {
    if ((Cypress.env('varlensPassword') as string) === '') {
      this.skip()
    }

    cy.varlensLogin()
    cy.varlensDismissResearchUseModal()
  })
}

declare global {
  namespace Cypress {
    interface Chainable {
      varlensResolveLoginPassword(): Chainable<string>
      varlensLogin(): Chainable<void>
    }
  }
}

export {}
