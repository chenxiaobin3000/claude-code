import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTelegramUserAccountStateDir } from './config.js'
export interface TelegramUserLease { release(): void }
function alive(pid: number): boolean { if (!Number.isSafeInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' } }
export function acquireTelegramUserLease(alias: string): TelegramUserLease {
  const path = join(getTelegramUserAccountStateDir(alias), 'connection.lock')
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd: number | null = null
    try {
      fd = openSync(path, 'wx', 0o600); writeFileSync(fd, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`); closeSync(fd); fd = null
      let released = false
      return { release(): void { if (released) return; released = true; try { const state = JSON.parse(readFileSync(path, 'utf8')) as { pid?: unknown }; if (state.pid === process.pid) rmSync(path, { force: true }) } catch { /* fail closed */ } } }
    } catch (error) {
      if (fd !== null) closeSync(fd)
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt > 0) throw new Error(`Telegram user account ${alias} already has an active Host connection.`)
      try { const state = JSON.parse(readFileSync(path, 'utf8')) as { pid?: unknown }; if (typeof state.pid === 'number' && alive(state.pid)) throw new Error(`Telegram user account ${alias} already has an active Host connection.`); rmSync(path, { force: true }) }
      catch (caught) { if (caught instanceof Error && caught.message.includes('active Host')) throw caught; if (existsSync(path)) throw new Error(`Telegram user account ${alias} already has an active Host connection.`) }
    }
  }
  throw new Error(`Telegram user account ${alias} already has an active Host connection.`)
}

