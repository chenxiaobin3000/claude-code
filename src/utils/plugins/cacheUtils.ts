import { clearAgentDefinitionsCache } from '@claude-code-best/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { clearPromptCache } from '@claude-code-best/builtin-tools/tools/SkillTool/prompt.js'
import { clearCommandsCache } from '../../commands.js'
import { clearAllOutputStylesCache } from '../../constants/outputStyles.js'
import { resetSentSkillNames } from '../attachments.js'
import { logError } from '../log.js'
import { clearPluginAgentCache } from './loadPluginAgents.js'
import { clearPluginCommandCache } from './loadPluginCommands.js'
import { clearPluginHookCache, pruneRemovedPluginHooks } from './loadPluginHooks.js'
import { clearPluginOutputStyleCache } from './loadPluginOutputStyles.js'
import { clearPluginCache } from './pluginLoader.js'
import { clearPluginOptionsCache } from './pluginOptionsStorage.js'

export function clearAllPluginCaches(): void {
  clearPluginCache()
  clearPluginCommandCache()
  clearPluginAgentCache()
  clearPluginHookCache()
  pruneRemovedPluginHooks().catch(error => logError(error))
  clearPluginOptionsCache()
  clearPluginOutputStyleCache()
  clearAllOutputStylesCache()
}

export function clearAllCaches(): void {
  clearAllPluginCaches()
  clearCommandsCache()
  clearAgentDefinitionsCache()
  clearPromptCache()
  resetSentSkillNames()
}
