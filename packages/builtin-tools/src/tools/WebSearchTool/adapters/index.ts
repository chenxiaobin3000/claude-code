/**
 * Search adapter factory — selects the appropriate backend.
 *
 * Priority (highest first):
 *   1. WEB_SEARCH_ADAPTER environment variable (explicit override)
 *   2. settings.webSearchAdapter (user-configurable via /web-tools)
 *   3. Fail with a clear configuration error
 */

import { getSettings_DEPRECATED } from 'src/utils/settings/settings.js'
import { BingSearchAdapter } from './bingAdapter.js'
import { BraveSearchAdapter } from './braveAdapter.js'
import { ExaSearchAdapter } from './exaAdapter.js'
import type { WebSearchAdapter } from './types.js'

export type {
  SearchResult,
  SearchOptions,
  SearchProgress,
  WebSearchAdapter,
} from './types.js'

export type SearchAdapterKey = 'bing' | 'brave' | 'exa'

let cachedAdapter: WebSearchAdapter | null = null
let cachedAdapterKey: SearchAdapterKey | null = null

export function createAdapter(): WebSearchAdapter {
  // 1. Explicit env override
  const envAdapter = process.env.WEB_SEARCH_ADAPTER
  // 2. Settings preference (set via /web-tools panel)
  const settingsAdapter = getSettings_DEPRECATED().webSearchAdapter

  const adapterKey: SearchAdapterKey | undefined =
    envAdapter === 'bing' ||
    envAdapter === 'brave' ||
    envAdapter === 'exa'
      ? envAdapter
      : settingsAdapter === 'bing' ||
          settingsAdapter === 'brave' ||
          settingsAdapter === 'exa'
        ? settingsAdapter
        : undefined

  if (!adapterKey) {
    throw new Error(
      'WebSearch requires WEB_SEARCH_ADAPTER or settings.webSearchAdapter to be configured as bing, brave, or exa',
    )
  }

  if (cachedAdapter && cachedAdapterKey === adapterKey) return cachedAdapter

  switch (adapterKey) {
    case 'bing':
      cachedAdapter = new BingSearchAdapter()
      break
    case 'brave':
      cachedAdapter = new BraveSearchAdapter()
      break
    case 'exa':
      cachedAdapter = new ExaSearchAdapter()
      break
  }

  cachedAdapterKey = adapterKey
  return cachedAdapter
}
