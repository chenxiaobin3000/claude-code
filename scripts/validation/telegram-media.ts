#!/usr/bin/env bun
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadTelegramAttachment, inferTelegramMediaKind, TELEGRAM_MEDIA_LIMIT, validateTelegramOutboundFile } from '../../plugins/telegram/src/media.js'
import { assert, assertEqual } from './assertions.js'

async function rejects(operation: () => Promise<unknown> | unknown, includes: string): Promise<void> {
  try { await operation() } catch (error) {
    assert(error instanceof Error && error.message.includes(includes), `expected error containing ${includes}`)
    return
  }
  throw new Error(`expected error containing ${includes}`)
}

const root = mkdtempSync(join(tmpdir(), 'telegram-media-'))
const allowed = join(root, 'allowed')
mkdirSync(allowed)
process.env.TELEGRAM_ALLOWED_FILE_ROOTS = allowed
process.env.TELEGRAM_API_ROOT = 'http://127.0.0.1:9999'
try {
  const file = join(allowed, 'photo.png'); writeFileSync(file, 'ok')
  assertEqual(validateTelegramOutboundFile(file), file, 'allowed Telegram outbound file')
  assertEqual(inferTelegramMediaKind(file), 'photo', 'photo media inference')
  const outside = join(root, 'outside.txt'); writeFileSync(outside, 'no')
  await rejects(() => validateTelegramOutboundFile(outside), 'outside')
  const downloaded = await downloadTelegramAttachment(
    '123456:abcdefghijklmnopqrstuvwxyz',
    { kind: 'document', fileId: 'file', fileName: '测试.txt', size: 2 },
    'alpha',
    '-100',
    7,
    async () => ({ file_path: 'documents/file.txt' }),
    async () => new Response('ok', { status: 200, headers: { 'content-length': '2' } }),
  )
  assert(downloaded.includes('telegram-media'), 'Telegram media stored in isolated temporary directory')
  await rejects(() => downloadTelegramAttachment('123456:abcdefghijklmnopqrstuvwxyz', { kind: 'document', fileId: 'big', size: TELEGRAM_MEDIA_LIMIT + 1 }, 'alpha', '1', 8, async () => ({ file_path: 'x' })), '20 MiB')
  await rejects(() => downloadTelegramAttachment('123456:abcdefghijklmnopqrstuvwxyz', { kind: 'document', fileId: 'bad' }, 'alpha', '1', 9, async () => ({ file_path: '../secret' })), 'invalid path')
} finally {
  delete process.env.TELEGRAM_ALLOWED_FILE_ROOTS; delete process.env.TELEGRAM_API_ROOT
  rmSync(root, { recursive: true, force: true })
}
console.log('[telegram-media] PASS')
