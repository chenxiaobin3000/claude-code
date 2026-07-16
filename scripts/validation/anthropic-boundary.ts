import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')

async function source(path: string): Promise<string> {
  return readFile(join(root, path), 'utf8')
}

function fail(message: string): never {
  throw new Error(`[anthropic-boundary] ${message}`)
}

function forbid(path: string, text: string, patterns: RegExp[]): void {
  for (const pattern of patterns) {
    if (pattern.test(text))
      fail(`${path} contains forbidden pattern ${pattern}`)
  }
}

const authPath = 'src/utils/auth.ts'
const auth = await source(authPath)
forbid(authPath, auth, [
  /process\.env\.ANTHROPIC_API_KEY/,
  /ANTHROPIC_AUTH_TOKEN/,
  /CLAUDE_CODE_OAUTH_TOKEN/,
  /refreshOAuthToken/,
  /getSecureStorage/,
  /services\/oauth\/client/,
])
if (!/isAnthropicAuthEnabled\(\): boolean \{\s*return false\s*\}/s.test(auth)) {
  fail('Anthropic account authentication must remain fail-closed')
}
if (
  !/getClaudeAIOAuthTokens\(\): OAuthTokens \| null \{\s*return null\s*\}/s.test(
    auth,
  )
) {
  fail('Claude account token lookup must remain disabled')
}

const providersPath = 'src/utils/model/providers.ts'
const providers = await source(providersPath)
if (
  !/getAPIProvider\(\): APIProvider \{\s*return 'openai'\s*\}/s.test(providers)
) {
  fail('runtime provider must remain OpenAI-compatible')
}
if (
  !/isFirstPartyAnthropicBaseUrl\(\): boolean \{\s*return false\s*\}/s.test(
    providers,
  )
) {
  fail('Anthropic first-party endpoint detection must remain fail-closed')
}

const clientPath = 'src/services/api/client.ts'
const client = await source(clientPath)
forbid(clientPath, client, [
  /new Anthropic\s*\(/,
  /getClaudeAIOAuthTokens/,
  /getAnthropicApiKey/,
  /ANTHROPIC_AUTH_TOKEN/,
  /getOauthConfig/,
])
if (!client.includes('Anthropic first-party model access has been removed')) {
  fail('Anthropic client fallback must reject first-party access')
}

const claudePath = 'src/services/api/claude.ts'
const claude = await source(claudePath)
forbid(claudePath, claude, [/export async function verifyApiKey\s*\(/])
const routeStart = claude.indexOf("if (getAPIProvider() === 'openai')")
const routeDelegate = claude.indexOf('yield* queryModelOpenAI(', routeStart)
const routeTail =
  routeDelegate < 0 ? '' : claude.slice(routeDelegate, routeDelegate + 500)
if (
  routeStart < 0 ||
  routeDelegate < 0 ||
  !/\r?\n {4}return\r?\n/.test(routeTail)
) {
  fail('main model query must delegate to OpenAI and return before legacy code')
}

const commandsPath = 'src/commands.ts'
const commands = await source(commandsPath)
forbid(commandsPath, commands, [
  /commands\/oauth-refresh/,
  /commands\/install-github-app/,
  /commands\/install-slack-app/,
  /commands\/agents-platform/,
  /commands\/schedule/,
  /commands\/memory-stores/,
  /commands\/skill-store/,
  /commands\/vault/,
  /commands\/desktop/,
  /commands\/fast/,
  /commands\/mobile/,
  /commands\/teleport/,
  /commands\/remote-setup/,
  /commands\/rate-limit-options/,
])

for (const path of [
  'src/interactiveHelpers.tsx',
  'src/components/Settings/Config.tsx',
  'src/hooks/useApiKeyVerification.ts',
]) {
  forbid(path, await source(path), [
    /process\.env\.ANTHROPIC_API_KEY/,
    /verifyApiKey\s*\(/,
    /ApproveApiKey/,
  ])
}

const mainPath = 'src/main.tsx'
const main = await source(mainPath)
forbid(mainPath, main, [/feature\(['"]SSH_REMOTE['"]\)/])
if (!/isSshRemoteEnabled\(\): boolean \{\s*return false;?\s*\}/s.test(main)) {
  fail('SSH authentication proxy entry point must remain disabled')
}

for (const command of ['login', 'logout', 'oauth-refresh']) {
  const dir = join(root, 'src', 'commands', command)
  try {
    if ((await readdir(dir)).length > 0) {
      fail(`/${command} command files must not exist`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

console.log('[anthropic-boundary] PASS')
