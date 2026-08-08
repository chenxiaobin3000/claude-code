#!/usr/bin/env bun
import { startOpenAIProxyGateway } from '../../plugins/openai-proxy/src/gateway.js'
import { assert, assertEqual } from './assertions.js'

const token = 'fixture-local-token-that-is-at-least-32-characters'
const gateway = startOpenAIProxyGateway('0.1.0-test', { token, port: 0 })
try {
  const health = await fetch(`${gateway.url}/health`)
  assertEqual(health.status, 200, 'unauthenticated health status')
  const healthBody = (await health.json()) as Record<string, unknown>
  assertEqual(healthBody.service, 'openai-proxy', 'health identity')
  assertEqual(healthBody.phase, 'foundation', 'foundation phase')

  const missing = await fetch(`${gateway.url}/doctor`)
  assertEqual(missing.status, 401, 'missing local token')
  assert(!(await missing.text()).includes(token), 'missing-token response is secret-free')

  const wrong = await fetch(`${gateway.url}/v1/models`, {
    headers: { authorization: 'Bearer wrong-token' },
  })
  assertEqual(wrong.status, 401, 'wrong local token')

  const headers = { authorization: `Bearer ${token}` }
  const doctor = await fetch(`${gateway.url}/doctor`, { headers })
  assertEqual(doctor.status, 200, 'authenticated doctor')
  const doctorBody = (await doctor.json()) as Record<string, unknown>
  assertEqual(
    doctorBody.forwarding,
    'not_implemented',
    'phase 1 forwarding status',
  )

  const models = await fetch(`${gateway.url}/v1/models`, { headers })
  assertEqual(models.status, 200, 'authenticated models endpoint')
  const modelBody = (await models.json()) as { data: unknown[] }
  assertEqual(modelBody.data.length, 0, 'no fabricated upstream models')

  const completion = await fetch(`${gateway.url}/v1/chat/completions`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'fixture', messages: [] }),
  })
  assertEqual(completion.status, 503, 'phase 1 completion fails closed')
  const completionBody = (await completion.json()) as {
    error: { code: string }
  }
  assertEqual(
    completionBody.error.code,
    'openai_proxy_not_ready',
    'deterministic not-ready error',
  )

  const missingRoute = await fetch(`${gateway.url}/unknown`, { headers })
  assertEqual(missingRoute.status, 404, 'unknown route')
} finally {
  gateway.stop()
}
console.log('[openai-proxy-gateway] PASS')
