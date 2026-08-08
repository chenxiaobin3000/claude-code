export interface OpenAIAccountClaims {
  email?: string
  planType?: string
  userId?: string
  accountId?: string
  isFedramp: boolean
}

type JsonObject = Record<string, unknown>

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function parseJwtPayload(jwt: string): JsonObject {
  const parts = jwt.split('.')
  if (parts.length !== 3 || parts.some(part => part.length === 0)) {
    throw new Error('Invalid JWT format.')
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'))
  } catch {
    throw new Error('Invalid JWT payload.')
  }
  const payload = asObject(decoded)
  if (!payload) throw new Error('Invalid JWT payload.')
  return payload
}

export function parseJwtExpiration(jwt: string): number | undefined {
  const exp = parseJwtPayload(jwt).exp
  return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1_000 : undefined
}

export function parseOpenAIAccountClaims(idToken: string): OpenAIAccountClaims {
  const payload = parseJwtPayload(idToken)
  const profile = asObject(payload['https://api.openai.com/profile'])
  const auth = asObject(payload['https://api.openai.com/auth'])
  return {
    email: asString(payload.email) ?? asString(profile?.email),
    planType: asString(auth?.chatgpt_plan_type),
    userId:
      asString(auth?.chatgpt_user_id) ?? asString(auth?.user_id),
    accountId: asString(auth?.chatgpt_account_id),
    isFedramp: auth?.chatgpt_account_is_fedramp === true,
  }
}
