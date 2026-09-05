import type { FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'

const RATE_LIMIT_WINDOW_MS = 60_000
const LOGIN_PAGE_RATE_LIMIT_MAX_ENV = 'VARLENS_LOGIN_PAGE_RATE_LIMIT_MAX'
const AUTH_LOGIN_RATE_LIMIT_MAX_ENV = 'VARLENS_AUTH_LOGIN_RATE_LIMIT_MAX'
const PLATFORM_AUTH_RATE_LIMIT_MAX_ENV = 'VARLENS_PLATFORM_AUTH_RATE_LIMIT_MAX'

function positiveIntegerFromEnv(params: {
  env: NodeJS.ProcessEnv
  name: string
  fallback: number
  max: number
}): number {
  const raw = params.env[params.name]
  if (raw === undefined || raw.trim() === '') return params.fallback

  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > params.max) {
    throw new Error(`${params.name} must be an integer in [1, ${params.max}]; got ${raw}`)
  }
  return value
}

export function buildLoginPageRateLimitConfig(env: NodeJS.ProcessEnv = process.env): {
  max: number
  timeWindow: number
  groupId: string
} {
  return {
    max: positiveIntegerFromEnv({
      env,
      name: LOGIN_PAGE_RATE_LIMIT_MAX_ENV,
      fallback: 120,
      max: 10_000
    }),
    timeWindow: RATE_LIMIT_WINDOW_MS,
    groupId: 'login-page'
  }
}

export function buildPlatformAuthRateLimitConfig(env: NodeJS.ProcessEnv = process.env): {
  max: number
  timeWindow: number
  groupId: string
} {
  return {
    max: positiveIntegerFromEnv({
      env,
      name: PLATFORM_AUTH_RATE_LIMIT_MAX_ENV,
      fallback: 60,
      max: 10_000
    }),
    timeWindow: RATE_LIMIT_WINDOW_MS,
    groupId: 'platform-auth'
  }
}

export async function registerWebRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    global: false,
    timeWindow: RATE_LIMIT_WINDOW_MS
  })
}

export function registerAuthLoginRateLimit(
  app: FastifyInstance,
  env: NodeJS.ProcessEnv = process.env
): void {
  const checkRateLimit = app.createRateLimit({
    max: positiveIntegerFromEnv({
      env,
      name: AUTH_LOGIN_RATE_LIMIT_MAX_ENV,
      fallback: 10,
      max: 10_000
    }),
    timeWindow: RATE_LIMIT_WINDOW_MS,
    keyGenerator: (request) => `auth-login:${request.ip}`
  })

  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?', 1)[0]
    if (request.method !== 'POST' || path !== '/api/auth/login') return

    const result = await checkRateLimit(request)
    if (result.isAllowed || !result.isExceeded) return

    reply.code(429)
    reply.header('retry-after', String(Math.max(1, result.ttlInSeconds)))
    return reply.send({
      code: 'RATE_LIMITED',
      message: 'login rate limit exceeded',
      userMessage: 'Too many login attempts. Try again shortly.'
    })
  })
}
