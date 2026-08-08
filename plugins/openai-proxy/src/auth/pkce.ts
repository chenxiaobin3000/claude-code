import { createHash, randomBytes } from 'node:crypto'

export interface PkceCodes {
  codeVerifier: string
  codeChallenge: string
}

export function base64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url')
}

export function challengeForVerifier(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier, 'utf8').digest('base64url')
}

export function generatePkce(): PkceCodes {
  const codeVerifier = base64Url(randomBytes(64))
  return {
    codeVerifier,
    codeChallenge: challengeForVerifier(codeVerifier),
  }
}

export function generateOAuthState(): string {
  return base64Url(randomBytes(32))
}
