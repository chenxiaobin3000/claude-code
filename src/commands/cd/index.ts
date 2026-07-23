import type { Command } from '../../commands.js'

const cd = {
  type: 'local',
  name: 'cd',
  description: 'Temporarily change the working directory for this session',
  argumentHint: '<directory>',
  supportsNonInteractive: false,
  load: () => import('./cd.js'),
} satisfies Command

export default cd
