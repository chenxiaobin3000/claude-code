#!/usr/bin/env bun
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QqApiClient, inferQqFileType } from '../../plugins/qq/src/api.js'
import { downloadQqAttachment } from '../../plugins/qq/src/media.js'
import { assert, assertEqual } from './assertions.js'
const root = mkdtempSync(join(tmpdir(), 'qq-media-'))
const path = join(root, 'image.png')
writeFileSync(path, Buffer.from('fixture'))
process.env.QQ_ALLOWED_FILE_ROOTS = root
try {
  const calls: Array<{ url: string; body?: string }> = []
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input); calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined })
    if (url.includes('getAppAccessToken')) return new Response(JSON.stringify({ access_token: 'access', expires_in: 7200 }), { status: 200 })
    if (url.endsWith('/files')) return new Response(JSON.stringify({ file_uuid: 'uuid', file_info: 'opaque-file-info', ttl: 60 }), { status: 200 })
    return new Response(JSON.stringify({ id: 'sent', timestamp: 1 }), { status: 200 })
  }
  const api = new QqApiClient({ alias: 'alpha', appId: 'a', secretEnv: 'S', savedAt: '' }, 'secret', fakeFetch, 'https://api.example.test', 'https://token.example.test')
  await api.sendMedia('group', 'group-a', 'message-a', path, 1)
  const upload = JSON.parse(calls.find(call => call.url.endsWith('/files'))?.body ?? '{}') as { file_type?: number; file_data?: string; srv_send_msg?: boolean }
  assertEqual(upload.file_type, 1, 'image media type'); assertEqual(upload.srv_send_msg, false, 'upload must not proactively send'); assertEqual(Buffer.from(upload.file_data ?? '', 'base64').toString(), 'fixture', 'media data')
  assert(calls.some(call => call.url.endsWith('/v2/groups/group-a/messages')), 'group media message route')
  assertEqual(inferQqFileType('a.mp4'), 2, 'video type'); assertEqual(inferQqFileType('a.ogg'), 3, 'voice type'); assertEqual(inferQqFileType('a.bin'), 4, 'file type')
  let escaped = false; try { await api.sendMedia('c2c', 'user-a', 'm2', join(root, '..', 'outside.bin'), 0) } catch { escaped = true }; assert(escaped, 'outside-root file must fail')
  let ssrf = false; try { await downloadQqAttachment({ content_type: 'image/png', url: 'https://127.0.0.1/private' }, 'alpha', 'm1') } catch { ssrf = true }; assert(ssrf, 'inbound media SSRF guard')
} finally { delete process.env.QQ_ALLOWED_FILE_ROOTS; rmSync(root, { recursive: true, force: true }) }
console.log('[qq-media] PASS')
