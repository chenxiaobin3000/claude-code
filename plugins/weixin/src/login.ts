import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { toString as qrToString } from 'qrcode'
import { apiGetJson, apiPostJson } from './api.js'

export type LoginStatus =
  | 'wait'
  | 'scaned'
  | 'confirmed'
  | 'expired'
  | 'scaned_but_redirect'
  | 'need_verifycode'
  | 'verify_code_blocked'
  | 'binded_redirect'

export interface QRCodeResult {
  qrcodeUrl?: string
  qrcodeId: string
  message: string
}

export interface LoginResult {
  connected: boolean
  alreadyConnected?: boolean
  token?: string
  accountId?: string
  baseUrl?: string
  userId?: string
  message: string
}

interface LoginStatusResponse {
  status?: LoginStatus
  bot_token?: string
  ilink_bot_id?: string
  baseurl?: string
  ilink_user_id?: string
  redirect_host?: string
}

async function renderQrCodeToTerminal(qrcodeUrl: string): Promise<void> {
  const output = await qrToString(qrcodeUrl, {
    type: 'terminal',
    errorCorrectionLevel: 'L',
    small: true,
  })
  process.stderr.write(`${output}\n`)
}

export function normalizeRedirectBaseUrl(host: string): string | null {
  const trimmed = host.trim()
  if (!trimmed || /[\\/?#@]/.test(trimmed)) return null
  try {
    const url = new URL(`https://${trimmed}`)
    return url.hostname === trimmed || url.host === trimmed ? url.origin : null
  } catch {
    return null
  }
}

export async function startLogin(
  apiBaseUrl: string,
  localTokens: string[] = [],
): Promise<QRCodeResult> {
  const data = await apiPostJson<{
    qrcode?: string
    qrcode_img_content?: string
  }>({
    baseUrl: apiBaseUrl,
    path: '/ilink/bot/get_bot_qrcode?bot_type=3',
    body: { local_token_list: localTokens.filter(Boolean).slice(-10).reverse() },
    label: 'getBotQRCode',
  })

  if (!data.qrcode) throw new Error('No qrcode in response')
  const qrcodeUrl = data.qrcode_img_content || ''
  if (qrcodeUrl) await renderQrCodeToTerminal(qrcodeUrl)
  return {
    qrcodeUrl,
    qrcodeId: data.qrcode,
    message: 'Scan the QR code with WeChat to connect.',
  }
}

async function readVerifyCodeDefault(prompt: string): Promise<string> {
  const reader = createInterface({ input: stdin, output: stdout })
  try {
    return (await reader.question(prompt)).trim()
  } finally {
    reader.close()
  }
}

async function pollLoginStatus(params: {
  apiBaseUrl: string
  qrcodeId: string
  verifyCode?: string
}): Promise<LoginStatusResponse> {
  let path = `/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(params.qrcodeId)}`
  if (params.verifyCode) {
    path += `&verify_code=${encodeURIComponent(params.verifyCode)}`
  }
  try {
    return await apiGetJson<LoginStatusResponse>({
      baseUrl: params.apiBaseUrl,
      path,
      timeoutMs: 35_000,
      label: 'getQRCodeStatus',
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { status: 'wait' }
    }
    process.stderr.write(
      `[weixin] QR status request failed temporarily: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    return { status: 'wait' }
  }
}

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve()
}

export async function waitForLogin(params: {
  qrcodeId: string
  apiBaseUrl: string
  timeoutMs?: number
  maxRetries?: number
  pollDelayMs?: number
  localTokens?: string[]
  readVerifyCode?: (prompt: string) => Promise<string>
}): Promise<LoginResult> {
  const {
    qrcodeId,
    apiBaseUrl,
    timeoutMs = 480_000,
    maxRetries = 3,
    pollDelayMs = 1000,
    localTokens = [],
    readVerifyCode = readVerifyCodeDefault,
  } = params
  const deadline = Date.now() + timeoutMs
  let currentQrcodeId = qrcodeId
  let currentBaseUrl = apiBaseUrl
  let retryCount = 0
  let verifyCode: string | undefined
  let scannedPrinted = false

  while (Date.now() < deadline) {
    const data = await pollLoginStatus({
      apiBaseUrl: currentBaseUrl,
      qrcodeId: currentQrcodeId,
      verifyCode,
    })

    switch (data.status) {
      case 'confirmed':
        return {
          connected: true,
          token: data.bot_token,
          accountId: data.ilink_bot_id,
          baseUrl: data.baseurl,
          userId: data.ilink_user_id,
          message: 'Connected to WeChat successfully!',
        }
      case 'scaned':
        verifyCode = undefined
        if (!scannedPrinted) {
          process.stderr.write('QR code scanned, waiting for confirmation...\n')
          scannedPrinted = true
        }
        break
      case 'need_verifycode':
        verifyCode = await readVerifyCode(
          verifyCode
            ? 'Verification code did not match. Enter the number shown in WeChat: '
            : 'Enter the number shown in WeChat: ',
        )
        continue
      case 'scaned_but_redirect': {
        const redirected = data.redirect_host
          ? normalizeRedirectBaseUrl(data.redirect_host)
          : null
        if (redirected) {
          currentBaseUrl = redirected
          process.stderr.write(`[weixin] Login redirected to ${new URL(redirected).host}.\n`)
        } else {
          process.stderr.write('[weixin] Ignored invalid login redirect host.\n')
        }
        break
      }
      case 'binded_redirect':
        return {
          connected: false,
          alreadyConnected: true,
          message: 'This WeChat bot is already connected; existing credentials remain valid.',
        }
      case 'expired':
      case 'verify_code_blocked': {
        retryCount += 1
        verifyCode = undefined
        scannedPrinted = false
        if (retryCount >= maxRetries) {
          return {
            connected: false,
            message:
              data.status === 'verify_code_blocked'
                ? 'Verification was blocked after too many incorrect attempts.'
                : 'QR code expired after maximum retries.',
          }
        }
        process.stderr.write(
          data.status === 'verify_code_blocked'
            ? 'Verification blocked, refreshing QR code...\n'
            : 'QR code expired, refreshing...\n',
        )
        currentBaseUrl = apiBaseUrl
        const refreshed = await startLogin(apiBaseUrl, localTokens)
        currentQrcodeId = refreshed.qrcodeId
        break
      }
      case 'wait':
      default:
        break
    }
    await delay(pollDelayMs)
  }

  return { connected: false, message: 'Login timed out.' }
}
