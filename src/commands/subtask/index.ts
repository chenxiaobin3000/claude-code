import type { Command } from '../../commands.js'

const subtask = {
  type: 'local-jsx',
  name: 'subtask',
  description: 'Delegate work to a background subagent in this session',
  argumentHint: '<prompt>',
  load: () => import('./subtask.js'),
} satisfies Command

export default subtask
