import { TelegramClient } from 'telegram'
import { NewMessage } from 'telegram/events'
import { StringSession } from 'telegram/sessions'

export function probeGramJsCompatibility(): { client: string; event: string; session: string } {
  const session = new StringSession('')
  const client = new TelegramClient(session, 1, '0123456789abcdef0123456789abcdef', { connectionRetries: 1 })
  const event = new NewMessage({})
  return {
    client: client.constructor.name,
    event: event.constructor.name,
    session: session.save(),
  }
}

if (import.meta.main) process.stdout.write(`${JSON.stringify(probeGramJsCompatibility())}\n`)
