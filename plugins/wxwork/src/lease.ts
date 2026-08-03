import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getBotStateDir } from './config.js'

export interface WxworkBotLease {
  alias: string
  path: string
  release(): void
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function removeStaleLease(path: string): boolean {
  try {
    const state = JSON.parse(readFileSync(path, 'utf8')) as { pid?: unknown }
    if (typeof state.pid === 'number' && isProcessAlive(state.pid)) return false
  } catch {
    // An unreadable or partial file cannot identify a live owner.
  }
  try {
    rmSync(path, { force: true })
    return true
  } catch {
    return false
  }
}

export function acquireWxworkBotLease(alias: string): WxworkBotLease {
  const path = join(getBotStateDir(alias), 'connection.lock')
  for (let attempt = 0; attempt < 2; attempt++) {
    let descriptor: number | null = null
    try {
      descriptor = openSync(path, 'wx', 0o600)
      writeFileSync(
        descriptor,
        `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
        'utf8',
      )
      closeSync(descriptor)
      descriptor = null
      let released = false
      return {
        alias,
        path,
        release(): void {
          if (released) return
          released = true
          if (!existsSync(path)) return
          try {
            const state = JSON.parse(readFileSync(path, 'utf8')) as { pid?: unknown }
            if (state.pid === process.pid) rmSync(path, { force: true })
          } catch {
            // Never remove a lock whose ownership can no longer be established.
          }
        },
      }
    } catch (error) {
      if (descriptor !== null) closeSync(descriptor)
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt > 0 || !removeStaleLease(path)) {
        throw new Error(`wxwork bot ${alias} already has an active Host connection.`)
      }
    }
  }
  throw new Error(`wxwork bot ${alias} already has an active Host connection.`)
}
