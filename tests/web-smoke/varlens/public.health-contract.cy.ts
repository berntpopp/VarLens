import {
  expectHealthEndpointReady,
  expectLivezEndpointOk,
  expectPublicLoginApiReachable,
  expectReadyzEndpointReady,
  expectSwaggerAndOpenApiContractPublic,
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

  it('serves the Swagger UI and OpenAPI contract publicly', () => {
    expectSwaggerAndOpenApiContractPublic()
  })
})
