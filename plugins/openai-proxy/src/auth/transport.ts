export interface AuthRequest {
  url: string
  method: 'POST'
  headers: Record<string, string>
  body: string
  signal?: AbortSignal
}

export type AuthTransport = (request: AuthRequest) => Promise<Response>

export const directAuthTransport: AuthTransport = request =>
  fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
    redirect: 'error',
  })

export async function readBoundedJson<T>(
  response: Response,
  label: string,
): Promise<T> {
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > 1024 * 1024) {
    throw new Error(`${label} response exceeded 1 MiB.`)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`${label} returned invalid JSON.`)
  }
}

export async function authRequest(
  transport: AuthTransport,
  request: Omit<AuthRequest, 'signal'>,
  timeoutMs = 30_000,
): Promise<Response> {
  return transport({
    ...request,
    signal: AbortSignal.timeout(timeoutMs),
  })
}
