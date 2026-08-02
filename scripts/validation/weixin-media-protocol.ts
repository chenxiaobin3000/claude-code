import {
  aesEcbPaddedSize,
  decryptAesEcb,
  encryptAesEcb,
  uploadBufferToCdn,
} from '../../plugins/weixin/src/media.js'
import {
  extractMessageText,
  selectInboundMedia,
} from '../../plugins/weixin/src/monitor.js'
import { MessageItemType } from '../../plugins/weixin/src/types.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[weixin-media-protocol] ${message}`)
}

const key = Buffer.alloc(16, 7)
const plaintext = Buffer.from('wechat media fixture')
const ciphertext = encryptAesEcb(plaintext, key)
assert(ciphertext.length === aesEcbPaddedSize(plaintext.length), 'padded size')
assert(decryptAesEcb(ciphertext, key).equals(plaintext), 'AES round trip')

const items = [
  {
    type: MessageItemType.TEXT,
    text_item: { text: 'current' },
    ref_msg: {
      title: 'author',
      message_item: { type: MessageItemType.TEXT, text_item: { text: 'quoted' } },
    },
  },
  {
    type: MessageItemType.FILE,
    file_item: { media: { full_url: 'https://cdn.example.test/file' } },
  },
  {
    type: MessageItemType.IMAGE,
    image_item: { media: { encrypt_query_param: 'image-param' } },
  },
]
assert(selectInboundMedia(items)?.type === MessageItemType.IMAGE, 'media priority')
assert(
  extractMessageText(items) === '[Quoted: author | quoted]\ncurrent',
  'quoted text',
)

const originalFetch = globalThis.fetch
let attempts = 0
globalThis.fetch = (async () => {
  attempts += 1
  if (attempts < 3) return new Response('', { status: 503 })
  return new Response('', {
    status: 200,
    headers: { 'x-encrypted-param': 'download-param' },
  })
}) as typeof fetch

try {
  const result = await uploadBufferToCdn({
    ciphertext,
    uploadFullUrl: 'https://upload.example.test/path',
    filekey: 'filekey',
    cdnBaseUrl: 'https://cdn.example.test',
  })
  assert(result === 'download-param', 'full upload URL and response parameter')
  assert(attempts === 3, 'retry server failures')
} finally {
  globalThis.fetch = originalFetch
}

console.log('[weixin-media-protocol] PASS')
