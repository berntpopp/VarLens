export interface PostgresDevConfig {
  url: string
  schema: string
}

export function getPostgresDevConfig(
  env: NodeJS.ProcessEnv = process.env
): PostgresDevConfig | null {
  const url = env.VARLENS_PG_URL

  if (url === undefined || url === '') {
    return null
  }

  return {
    url,
    schema: env.VARLENS_PG_SCHEMA || 'public'
  }
}
