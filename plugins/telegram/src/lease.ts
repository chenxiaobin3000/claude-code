import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTelegramBotStateDir } from './config.js'

export interface TelegramBotLease { release(): void }
function alive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
}
export function acquireTelegramBotLease(alias: string): TelegramBotLease {
  const path = join(getTelegramBotStateDir(alias), 'connection.lock')
  for (let attempt = 0; attempt < 2; attempt++) {
    let descriptor: number | null = null
    try {
      descriptor = openSync(path, 'wx', 0o600)
      writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`)
      closeSync(descriptor)
      descriptor = null
      let released = false
      return { release(): void {
        if (released) return
        released = true
        try {
          const state = JSON.parse(readFileSync(path, 'utf8')) as { pid?: unknown }
          if (state.pid === process.pid) rmSync(path, { force: true })
        } catch { /* Ownership cannot be established. */ }
      } }
    } catch (error) {
      if (descriptor !== null) closeSync(descriptor)
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt > 0) throw new Error(`Telegram bot ${alias} already has an active Host connection.`)
      try {
        const state = JSON.parse(readFileSync(path, 'utf8')) as { pid?: unknown }
        if (typeof state.pid === 'number' && alive(state.pid)) throw new Error(`Telegram bot ${alias} already has an active Host connection.`)
        rmSync(path, { force: true })
      } catch (caught) {
        if (caught instanceof Error && caught.message.includes('already has')) throw caught
        if (existsSync(path)) throw new Error(`Telegram bot ${alias} already has an active Host connection.`)
      }
    }
  }
  throw new Error(`Telegram bot ${alias} already has an active Host connection.`)
}
