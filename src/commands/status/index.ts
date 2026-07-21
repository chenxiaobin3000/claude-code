import type { Command } from '../../commands.js'

const status = {
  type: 'local-jsx',
  name: 'status',
  description:
    'Show Claude Code status including version, model registry, endpoint, proxy, and tool statuses',
  immediate: true,
  load: () => import('./status.js'),
} satisfies Command

export default status
