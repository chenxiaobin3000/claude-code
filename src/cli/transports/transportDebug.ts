import { logForDebugging } from '../../utils/debug.js'

/** Local transport diagnostics shared by self-hosted RCS connections. */
export function rcLog(message: string): void {
  logForDebugging(`[remote-transport] ${message}`)
}
