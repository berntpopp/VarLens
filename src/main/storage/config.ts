export interface PostgresDevConfig {
  url: string
  schema: string
}

export function getPostgresDevConfig(
  env: NodeJS.ProcessEnv = process.env
): PostgresDevConfig | null {
  const url = env.VARLENS_PG_URL
  const schema = env.VARLENS_PG_SCHEMA

  if (url === undefined || url === '') {
    return null
  }

  return {
    url,
    schema: schema === undefined || schema === '' ? 'public' : schema
  }
}
