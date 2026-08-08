export const OPENAI_PROXY_HOST = '127.0.0.1' as const
export const OPENAI_PROXY_PORT = 48_181
export const OPENAI_PROXY_LOCAL_TOKEN_ENV = 'OPENAI_PROXY_LOCAL_TOKEN' as const
export const OPENAI_PROXY_BASE_URL =
  `http://${OPENAI_PROXY_HOST}:${OPENAI_PROXY_PORT}` as const

export function resolveLocalToken(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const token = env[OPENAI_PROXY_LOCAL_TOKEN_ENV]?.trim()
  if (!token || token.length < 32) {
    throw new Error(
      `${OPENAI_PROXY_LOCAL_TOKEN_ENV} must contain at least 32 non-whitespace characters.`,
    )
  }
  return token
}
