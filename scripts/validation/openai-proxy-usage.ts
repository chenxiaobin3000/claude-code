#!/usr/bin/env bun
import type { OpenAIProxySession } from '../../plugins/openai-proxy/src/auth/session.js'
import {
  OpenAIProxyUsageService,
  parseOpenAIProxyUsage,
} from '../../plugins/openai-proxy/src/usage.js'
import {
  formatOpenAIProxyQuota,
  openAIProxyUsageTargetFromModel,
  parseOpenAIProxyQuotaSnapshot,
} from '../../src/services/providerUsage/openaiProxy.js'
import { assert, assertEqual } from './assertions.js'

const session: OpenAIProxySession = {
  version: 1,
  authMode: 'chatgpt',
  tokens: {
    idToken: 'fixture-id',
    accessToken: 'fixture-access',
    refreshToken: 'fixture-refresh',
  },
  account: { accountId: 'fixture-account', isFedramp: false },
  updatedAt: new Date(0).toISOString(),
}

const parsed = parseOpenAIProxyUsage(
  {
    rate_limit: {
      primary_window: {
        used_percent: 12,
        limit_window_seconds: 18_000,
        reset_at: 456,
      },
      secondary_window: {
        used_percent: 34.5,
        limit_window_seconds: 604_800,
        reset_at: 789,
      },
    },
  },
  123,
)
assertEqual(parsed.primary?.remainingPercent, 88, '5h remaining percent')
assertEqual(parsed.primary?.windowMinutes, 300, '5h window minutes')
assertEqual(parsed.secondary?.remainingPercent, 65.5, '7d remaining percent')
assertEqual(parsed.secondary?.windowMinutes, 10_080, '7d window minutes')

let now = 1_000
let requests = 0
const service = new OpenAIProxyUsageService({
  auth: {
    async getValidSession() {
      return session
    },
    async forceRefreshSession() {
      throw new Error('unexpected refresh')
    },
  },
  transport: async request => {
    requests++
    assert(
      request.url.endsWith('/backend-api/wham/usage'),
      'official ChatGPT usage route',
    )
    assertEqual(
      request.headers['chatgpt-account-id'],
      'fixture-account',
      'account routing header',
    )
    return Response.json({
      rate_limit: {
        primary_window: { used_percent: 10 },
        secondary_window: { used_percent: 20 },
      },
    })
  },
  now: () => now,
  cacheTtlMs: 60_000,
})
const first = await service.usage(new AbortController().signal)
const cached = await service.usage(new AbortController().signal)
assertEqual(first.primary?.remainingPercent, 90, 'service primary remaining')
assertEqual(cached.secondary?.remainingPercent, 80, 'cached secondary')
assertEqual(requests, 1, 'usage response cached')
now += 60_001
await service.usage(new AbortController().signal)
assertEqual(requests, 2, 'usage cache expires')

const target = openAIProxyUsageTargetFromModel(
  {
    baseUrl: 'http://127.0.0.1:48481/v1',
    apiKeyEnv: 'OPENAI_PROXY_LOCAL_TOKEN',
  },
  { OPENAI_PROXY_LOCAL_TOKEN: 'fixture-local-token' },
)
assertEqual(
  target?.endpoint,
  'http://127.0.0.1:48481/v1/usage',
  'local usage endpoint',
)
assertEqual(
  openAIProxyUsageTargetFromModel(
    {
      baseUrl: 'https://api.example.com/v1',
      apiKeyEnv: 'OPENAI_PROXY_LOCAL_TOKEN',
    },
    { OPENAI_PROXY_LOCAL_TOKEN: 'fixture-local-token' },
  ),
  null,
  'remote endpoint rejected',
)

const uiSnapshot = parseOpenAIProxyQuotaSnapshot(parsed)
assertEqual(uiSnapshot?.primary?.remainingPercent, 88, 'UI primary parser')
assertEqual(uiSnapshot?.primary?.windowMinutes, 300, 'UI primary window')
assertEqual(
  uiSnapshot?.secondary?.remainingPercent,
  65.5,
  'UI secondary parser',
)
assertEqual(uiSnapshot?.secondary?.windowMinutes, 10_080, 'UI secondary window')
assertEqual(
  uiSnapshot ? formatOpenAIProxyQuota(uiSnapshot) : '',
  '5h: 88% · 7d: 66%',
  'footer quota format',
)
assertEqual(
  parseOpenAIProxyQuotaSnapshot({ primary: {}, secondary: {} }),
  null,
  'incomplete UI snapshot rejected',
)

const primaryOnlySnapshot = parseOpenAIProxyQuotaSnapshot({
  primary: { remainingPercent: 17, windowMinutes: 10_080 },
  capturedAt: 456,
})
assertEqual(
  primaryOnlySnapshot ? formatOpenAIProxyQuota(primaryOnlySnapshot) : '',
  '7d: 17%',
  'footer labels a primary-only weekly quota by duration',
)

const secondaryOnlySnapshot = parseOpenAIProxyQuotaSnapshot({
  secondary: { remainingPercent: 64, windowMinutes: 300 },
  capturedAt: 789,
})
assertEqual(
  secondaryOnlySnapshot ? formatOpenAIProxyQuota(secondaryOnlySnapshot) : '',
  '5h: 64%',
  'footer labels a secondary-only five-hour quota by duration',
)

console.log('[openai-proxy-usage] PASS')
