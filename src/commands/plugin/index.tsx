import type { Command } from '../../commands.js';

const plugin = {
  type: 'local-jsx',
  name: 'plugin',
  aliases: ['plugins'],
  description: 'List and validate local plugins',
  immediate: true,
  load: () => import('./plugin.js'),
} satisfies Command;

export default plugin;
