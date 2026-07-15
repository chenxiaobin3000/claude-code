import type { LocalJSXCommandContext } from '../../commands.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
): Promise<null> {
  void context;
  setTimeout(onDone, 0, 'Anthropic account login and subscription upgrades are not supported in this distribution.');
  return null;
}
