import { shouldRespondToBashCommand } from '../../src/utils/processUserInput/bashResponse.js'
import { SettingsSchema } from '../../src/utils/settings/types.js'
import { assertEqual } from './assertions.js'

assertEqual(
  shouldRespondToBashCommand({}),
  true,
  'unset respondToBashCommands must use the official automatic-response default',
)
assertEqual(
  shouldRespondToBashCommand({ respondToBashCommands: true }),
  true,
  'explicit true must request a model response',
)
assertEqual(
  shouldRespondToBashCommand({ respondToBashCommands: false }),
  false,
  'explicit false must preserve context-only shell mode',
)
assertEqual(
  shouldRespondToBashCommand({ respondToBashCommands: true }, true),
  false,
  'interrupted shell commands must not start a model response',
)

const schema = SettingsSchema()
assertEqual(
  schema.safeParse({ respondToBashCommands: true }).success,
  true,
  'settings schema must accept boolean respondToBashCommands',
)
assertEqual(
  schema.safeParse({ respondToBashCommands: 'true' }).success,
  false,
  'settings schema must reject non-boolean respondToBashCommands',
)

console.log('[bash-response] PASS')
