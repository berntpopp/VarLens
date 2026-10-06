import {
  expectHealthEndpointReady,
  expectLivezEndpointOk,
  expectPublicLoginApiReachable,
  expectReadyzEndpointReady,
  expectSwaggerAndOpenApiContractRequireSession,
  resetAnonymousBrowser
} from '../support/public-contracts'

describe('VarLens public health and API contract smoke', () => {
  beforeEach(() => {
    resetAnonymousBrowser()
  })

  it('serves a healthy web process with database connectivity', () => {
    expectLivezEndpointOk()
    expectReadyzEndpointReady()
    expectHealthEndpointReady()
  })

  it('keeps the public login API documented and reachable', () => {
    expectPublicLoginApiReachable()
  })

  it('keeps the Swagger UI and OpenAPI contract behind a session', () => {
    expectSwaggerAndOpenApiContractRequireSession()
  })
})
