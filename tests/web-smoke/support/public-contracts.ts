export function resetAnonymousBrowser(): void {
  cy.clearCookies()
  cy.clearLocalStorage()
}

export function expectAnonymousUsersRedirectToLogin(): void {
  cy.visit('/', { failOnStatusCode: false })
  cy.location('pathname', { timeout: 15000 }).should('contain', '/login')
  cy.contains(/Sign in to continue/i, { timeout: 15000 }).should('be.visible')
  cy.get('input:visible').should('have.length.at.least', 2)
  cy.contains('button', /Sign in/i).should('be.visible')
}

export function expectLoginPageDoesNotExposeAppShell(): void {
  cy.request('/login').then((response) => {
    expect(response.status).to.eq(200)
    expect(response.headers['content-type']).to.contain('text/html')
    expect(response.body).to.contain('Sign in to continue')
  })

  cy.request({
    url: '/',
    followRedirect: false,
    failOnStatusCode: false
  }).then((response) => {
    expect([302, 303], 'anonymous app shell redirect').to.include(response.status)
    expect(response.headers.location, 'redirect target').to.contain('/login')
  })
}

export function expectCaseDataRequiresAuthentication(): void {
  cy.varlensApi('cases', 'query', [{ limit: 10, offset: 0, search_term: null }]).then(
    (response) => {
      expect(response.status, 'anonymous case query').to.be.oneOf([401, 403])
    }
  )
}

export function expectHealthEndpointReady(): void {
  cy.request('/healthz').then((response) => {
    expect(response.status).to.eq(200)
    expect(response.body).to.include({ status: 'ok' })
    expect(response.body.db).to.include({ open: true })
    expect(response.body.version).to.be.a('string').and.not.be.empty
  })
}

export function expectLivezEndpointOk(): void {
  cy.request('/livez').then((response) => {
    expect(response.status).to.eq(200)
    expect(response.body).to.include({ status: 'ok' })
    expect(response.body.version).to.be.a('string').and.not.be.empty
  })
}

export function expectReadyzEndpointReady(): void {
  cy.request('/readyz').then((response) => {
    expect(response.status).to.eq(200)
    expect(response.body).to.include({ status: 'ok' })
    expect(response.body.db).to.include({ open: true })
    expect(response.body.version).to.be.a('string').and.not.be.empty
  })
}

export function expectPublicLoginApiReachable(): void {
  cy.varlensApi('auth', 'isAccountsEnabled').then((response) => {
    expect(response.status).to.eq(200)
    expect(response.body).to.be.a('boolean')
  })
}

/**
 * P-21: the Swagger UI and OpenAPI document describe the whole RPC surface, so
 * anonymous clients get 401 unless the operator sets VARLENS_WEB_PUBLIC_API_DOCS=1.
 */
export function expectSwaggerAndOpenApiContractRequireSession(): void {
  for (const url of ['/api/docs/', '/api/openapi.json']) {
    cy.request({ url, failOnStatusCode: false }).then((response) => {
      expect(response.status).to.eq(401)
    })
  }
}
