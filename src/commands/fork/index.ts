import type { Command } from '../../commands.js'

const fork = {
  type: 'local-jsx',
  name: 'fork',
  description: 'Fork the current conversation into a background session',
  argumentHint: '<prompt>',
  load: () => import('./fork.js'),
} satisfies Command

export default fork
