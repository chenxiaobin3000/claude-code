import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { getUploadUrl } from './api.js'
import { UploadMediaType } from './types.js'

export const WEIXIN_MEDIA_MAX_BYTES = 100 * 1024 * 1024
const CDN_UPLOAD_MAX_RETRIES = 3

export function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null)
  return Buffer.concat([cipher.update(plaintext), cipher.final()])
}

export function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv('aes-128-ecb', key, null)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

export function aesEcbPaddedSize(size: number): number {
  return size + (16 - (size % 16))
}

export function buildCdnDownloadUrl(
  encryptedQueryParam: string,
  cdnBaseUrl: string,
): string {
  return `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`
}

export function buildCdnUploadUrl(
  cdnBaseUrl: string,
  uploadParam: string,
  filekey: string,
): string {
  return `${cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`
}

function validateHttpUrl(value: string, label: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${label} must use HTTP or HTTPS`)
  }
  return url.toString()
}

export function parseAesKey(aesKeyBase64: string): Buffer {
  const decoded = Buffer.from(aesKeyBase64, 'base64')
  if (decoded.length === 16) {
    return decoded
  }
  if (
    decoded.length === 32 &&
    /^[0-9a-fA-F]{32}$/.test(decoded.toString('ascii'))
  ) {
    return Buffer.from(decoded.toString('ascii'), 'hex')
  }
  throw new Error(
    `Invalid aes_key: expected 16 raw bytes or 32 hex chars, got ${decoded.length} bytes`,
  )
}

export async function downloadAndDecrypt(params: {
  encryptQueryParam?: string
  aesKey?: string
  cdnBaseUrl: string
  fullUrl?: string
}): Promise<Buffer> {
  const url = params.fullUrl
    ? validateHttpUrl(params.fullUrl, 'CDN download URL')
    : params.encryptQueryParam
      ? buildCdnDownloadUrl(params.encryptQueryParam, params.cdnBaseUrl)
      : ''
  if (!url) throw new Error('CDN download URL is missing')
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`CDN download failed: HTTP ${response.status}`)
  }
  const declaredSize = Number(response.headers.get('content-length') || 0)
  if (declaredSize > WEIXIN_MEDIA_MAX_BYTES) {
    throw new Error('CDN media exceeds the 100 MiB limit')
  }
  const ciphertext = Buffer.from(await response.arrayBuffer())
  if (ciphertext.length > WEIXIN_MEDIA_MAX_BYTES) {
    throw new Error('CDN media exceeds the 100 MiB limit')
  }
  return params.aesKey
    ? decryptAesEcb(ciphertext, parseAesKey(params.aesKey))
    : ciphertext
}

class CdnClientError extends Error {}

export async function uploadBufferToCdn(params: {
  ciphertext: Buffer
  uploadFullUrl?: string
  uploadParam?: string
  filekey: string
  cdnBaseUrl: string
}): Promise<string> {
  const target = params.uploadFullUrl?.trim()
    ? validateHttpUrl(params.uploadFullUrl, 'CDN upload URL')
    : params.uploadParam
      ? buildCdnUploadUrl(params.cdnBaseUrl, params.uploadParam, params.filekey)
      : ''
  if (!target) throw new Error('CDN upload URL is missing')

  let lastError: unknown
  for (let attempt = 1; attempt <= CDN_UPLOAD_MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(params.ciphertext),
      })
      if (response.status >= 400 && response.status < 500) {
        throw new CdnClientError(`CDN upload rejected with HTTP ${response.status}`)
      }
      if (!response.ok) {
        throw new Error(`CDN upload failed with HTTP ${response.status}`)
      }
      const encryptedParam = response.headers.get('x-encrypted-param')?.trim()
      if (!encryptedParam) {
        throw new Error('CDN upload response is missing x-encrypted-param')
      }
      return encryptedParam
    } catch (error) {
      if (error instanceof CdnClientError) throw error
      lastError = error
      if (attempt < CDN_UPLOAD_MAX_RETRIES) continue
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('CDN upload failed after retries')
}

export interface UploadedFileInfo {
  encryptQueryParam: string
  aesKey: string
  fileSize: number
  rawSize: number
  fileName: string
}

export async function uploadFile(params: {
  filePath: string
  toUserId: string
  mediaType: number
  apiBaseUrl: string
  token: string
  cdnBaseUrl: string
  accountId?: string
}): Promise<UploadedFileInfo> {
  const plaintext = readFileSync(params.filePath)
  if (plaintext.length > WEIXIN_MEDIA_MAX_BYTES) {
    throw new Error('WeChat attachment exceeds the 100 MiB limit')
  }
  const rawSize = plaintext.length
  const rawMd5 = createHash('md5').update(plaintext).digest('hex')
  const aesKey = randomBytes(16)
  const filekey = randomBytes(16).toString('hex')
  const ciphertext = encryptAesEcb(plaintext, aesKey)
  const fileSize = ciphertext.length

  const uploadResp = await getUploadUrl(params.apiBaseUrl, params.token, {
    filekey,
    media_type: params.mediaType,
    to_user_id: params.toUserId,
    rawsize: rawSize,
    rawfilemd5: rawMd5,
    filesize: fileSize,
    no_need_thumb: true,
    aeskey: aesKey.toString('hex'),
  }, params.accountId)

  const encryptQueryParam = await uploadBufferToCdn({
    ciphertext,
    uploadFullUrl: uploadResp.upload_full_url,
    uploadParam: uploadResp.upload_param,
    filekey,
    cdnBaseUrl: params.cdnBaseUrl,
  })

  return {
    encryptQueryParam,
    aesKey: Buffer.from(aesKey.toString('hex')).toString('base64'),
    fileSize,
    rawSize,
    fileName: basename(params.filePath),
  }
}

export function guessMediaType(filePath: string): number {
  const ext = extname(filePath).toLowerCase()
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic']
  const videoExts = ['.mp4', '.mov', '.avi', '.mkv', '.webm']

  if (imageExts.includes(ext)) return UploadMediaType.IMAGE
  if (videoExts.includes(ext)) return UploadMediaType.VIDEO
  return UploadMediaType.FILE
}

export async function downloadRemoteToTemp(
  url: string,
  destDir?: string,
): Promise<string> {
  const parsedUrl = new URL(url)
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('Remote media URL must use HTTP or HTTPS')
  }
  const dir = destDir || join(tmpdir(), 'weixin-downloads')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const response = await fetch(url)
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`)

  const declaredSize = Number(response.headers.get('content-length') || 0)
  if (declaredSize > WEIXIN_MEDIA_MAX_BYTES) {
    throw new Error('Remote media exceeds the 100 MiB limit')
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > WEIXIN_MEDIA_MAX_BYTES) {
    throw new Error('Remote media exceeds the 100 MiB limit')
  }
  const urlPath = new URL(url).pathname
  const name = `${randomUUID()}-${basename(urlPath) || 'file'}`
  const dest = join(dir, name)
  writeFileSync(dest, buffer)
  return dest
}
