#!/usr/bin/env bun

import { createCipheriv, randomBytes } from 'node:crypto'
import { decryptWxworkFile, inferWxworkMediaType, WXWORK_MEDIA_LIMITS, WXWORK_UPLOAD_CHUNK_BYTES } from '../../plugins/wxwork/src/media.js'
import { assert, assertEqual } from './assertions.js'

const key = randomBytes(32)
const plain = Buffer.from('wxwork media fixture')
const padding = 32 - (plain.length % 32)
const padded = Buffer.concat([plain, Buffer.alloc(padding, padding)])
const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16))
cipher.setAutoPadding(false)
const encrypted = Buffer.concat([cipher.update(padded), cipher.final()])
assert(decryptWxworkFile(encrypted, key.toString('base64')).equals(plain), 'AES-256-CBC media decryption')
assertEqual(WXWORK_UPLOAD_CHUNK_BYTES, 512 * 1024, 'upload chunk limit')
assertEqual(WXWORK_MEDIA_LIMITS.file, 20 * 1024 * 1024, 'file size limit')
assertEqual(inferWxworkMediaType(process.platform === 'win32' ? 'D:\\tmp\\a.png' : '/tmp/a.png'), 'image', 'image inference')
assertEqual(inferWxworkMediaType(process.platform === 'win32' ? 'D:\\tmp\\a.bin' : '/tmp/a.bin'), 'file', 'file inference')

console.log('[wxwork-media] PASS')
