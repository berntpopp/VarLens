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

export function expectSwaggerAndOpenApiContractPublic(): void {
  cy.request('/api/docs/').then((response) => {
    expect(response.status).to.eq(200)
    expect(response.headers['content-type']).to.contain('text/html')
    expect(response.body).to.contain('VarLens Web API Docs')
    expect(response.body).to.contain('swagger-ui')
  })

  cy.request('/api/docs/static/swagger-initializer.js').then((response) => {
    expect(response.status).to.eq(200)
    expect(response.body).to.contain('/api/openapi.json')
  })

  cy.request('/api/openapi.json').then((response) => {
    expect(response.status).to.eq(200)
    expect(response.body.openapi).to.match(/^3\./)
    expect(response.body.info.title).to.eq('VarLens Web API')
    expect(response.body.paths).to.have.property('/api/auth/login')
    expect(response.body.paths).to.have.property('/api/import/upload')
    expect(response.body.paths).to.have.property('/api/import/start')
    expect(response.body.paths).to.have.property('/api/import/startMultiFile')
    expect(response.body.paths).to.have.property('/api/batch-import/testZipPassword')
    expect(response.body.paths).to.have.property('/api/batch-import/extractZip')
    expect(response.body.paths).to.have.property('/api/batch-import/cleanupZipTemp')
    expect(response.body.paths).to.have.property('/api/region-files/importBed')
    expect(response.body.paths).to.not.have.property('/login')
    expect(response.body.paths).to.not.have.property('/login/')
    expect(JSON.stringify(response.body)).to.not.contain('Generic RPC fallback')
  })
}
