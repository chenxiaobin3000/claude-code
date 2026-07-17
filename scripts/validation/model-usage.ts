import { EMPTY_USAGE } from '@ant/model-provider'
import { accumulateUsage, mergeUsage } from '../../src/services/model/usage.js'
import { assertDeepEqual, assertEqual } from './assertions.js'

const initial = {
  ...EMPTY_USAGE,
  input_tokens: 20,
  output_tokens: 2,
  cache_creation_input_tokens: 3,
  cache_read_input_tokens: 5,
}
const merged = mergeUsage(initial, {
  input_tokens: 0,
  output_tokens: 7,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
})
assertDeepEqual(
  {
    input: merged.input_tokens,
    output: merged.output_tokens,
    cacheCreation: merged.cache_creation_input_tokens,
    cacheRead: merged.cache_read_input_tokens,
  },
  { input: 20, output: 7, cacheCreation: 3, cacheRead: 5 },
  'cumulative usage merge',
)

const accumulated = accumulateUsage(initial, {
  ...EMPTY_USAGE,
  input_tokens: 10,
  output_tokens: 4,
  cache_creation_input_tokens: 2,
  cache_read_input_tokens: 1,
})
assertDeepEqual(
  {
    input: accumulated.input_tokens,
    output: accumulated.output_tokens,
    cacheCreation: accumulated.cache_creation_input_tokens,
    cacheRead: accumulated.cache_read_input_tokens,
  },
  { input: 30, output: 6, cacheCreation: 5, cacheRead: 6 },
  'session usage accumulation',
)

const detailed = mergeUsage(
  EMPTY_USAGE,
  {
    input_tokens: 80,
    output_tokens: 30,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 20,
    raw_input_tokens: 100,
    total_tokens: 130,
    reasoning_output_tokens: 10,
    cache_write_input_tokens: 5,
    usage_complete: true,
  } as unknown as Parameters<typeof mergeUsage>[1],
)
assertEqual(detailed.raw_input_tokens, 100, 'raw prompt token detail')
assertEqual(detailed.total_tokens, 130, 'total token detail')
assertEqual(detailed.reasoning_output_tokens, 10, 'reasoning token detail')
assertEqual(detailed.cache_write_input_tokens, 5, 'cache-write token detail')
assertEqual(detailed.usage_complete, true, 'usage completeness marker')

console.log('[validation] model usage passed')
