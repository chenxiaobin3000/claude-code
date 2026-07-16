import type { UserMessage } from '../../src/types/message.js'
import { getCacheControl } from '../../src/services/model/cacheControl.js'
import { stripExcessMediaItems } from '../../src/services/model/prepareRequest.js'
import { assertDeepEqual, assertEqual } from './assertions.js'

const message = {
  type: 'user',
  uuid: '00000000-0000-4000-8000-000000000010',
  message: {
    role: 'user',
    content: [
      { type: 'text', text: 'keep text' },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'old' },
      },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'new' },
      },
    ],
  },
} as unknown as UserMessage

const stripped = stripExcessMediaItems([message], 1)
const content = stripped[0]?.message.content
assertEqual(Array.isArray(content), true, 'prepared media content shape')
assertDeepEqual(
  content,
  [
    { type: 'text', text: 'keep text' },
    {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'new' },
    },
  ],
  'oldest media removal',
)
assertDeepEqual(
  getCacheControl({ querySource: 'auto_mode' }),
  { type: 'ephemeral' },
  'provider-neutral cache marker',
)

console.log('[validation] model preparation passed')
