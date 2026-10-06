import type { FastifyReply } from 'fastify'

export function badRequest(
  reply: FastifyReply,
  error: string,
  message: string
): {
  error: string
  message: string
} {
  reply.code(400)
  return { error, message }
}

/**
 * 503 for a served method whose server-side service was not wired (a
 * deployment/configuration fault, not a parity gap): the method is `shared`
 * in the parity manifest and must never answer 501.
 */
export function serviceNotConfigured(
  reply: FastifyReply,
  service: string
): { error: string; service: string; message: string } {
  reply.code(503)
  return {
    error: 'service-not-configured',
    service,
    message: `${service} is not configured on this server.`
  }
}

export function unsupportedWebCapability(
  reply: FastifyReply,
  capability: string
): {
  error: string
  capability: string
  message: string
} {
  reply.code(501)
  return {
    error: 'unsupported-web-capability',
    capability,
    message: `${capability} is not available in web mode yet.`
  }
}
