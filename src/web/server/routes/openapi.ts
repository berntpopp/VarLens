import type { FastifyInstance } from 'fastify'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider
} from 'fastify-type-provider-zod'
import { z } from 'zod'

import pkg from '../../../../package.json'
import { appendDocumentedDispatcherPaths } from './openapi-paths'

export { appendDocumentedDispatcherPaths } from './openapi-paths'
export { toOpenApiJsonSchema } from './openapi-utils'

const OPENAPI_JSON_URL = '/api/openapi.json'
const OPENAPI_DOCUMENT_NAME = 'VarLens Web API'

export async function registerOpenApi(app: FastifyInstance): Promise<void> {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'VarLens Web API',
        version: pkg.version
      },
      components: {
        securitySchemes: {
          sessionCookie: {
            type: 'apiKey',
            in: 'cookie',
            name: '__Host-varlens.sid'
          }
        }
      },
      security: [{ sessionCookie: [] }]
    },
    transform: jsonSchemaTransform,
    transformObject: (opts: Record<string, unknown>) =>
      appendDocumentedDispatcherPaths(
        (opts.openapiObject ?? opts.swaggerObject ?? opts) as Parameters<
          typeof appendDocumentedDispatcherPaths
        >[0]
      )
  })

  await app.register(swaggerUi as unknown as Parameters<typeof app.register>[0], {
    routePrefix: '/api/docs',
    staticCSP: true,
    uiConfig: {
      urls: [{ url: OPENAPI_JSON_URL, name: OPENAPI_DOCUMENT_NAME }],
      'urls.primaryName': OPENAPI_DOCUMENT_NAME,
      deepLinking: true,
      docExpansion: 'list'
    } as unknown as Record<string, unknown>,
    theme: {
      title: 'VarLens Web API Docs'
    }
  })

  app.withTypeProvider<ZodTypeProvider>().get(
    OPENAPI_JSON_URL,
    {
      schema: {
        hide: true,
        response: {
          200: z.record(z.string(), z.unknown())
        }
      }
    },
    async () => app.swagger() as unknown as Record<string, unknown>
  )
}
