/**
 * The one place that knows how to *do* something to a server.
 *
 * Both automation paths run through here - the cron scheduler (./scheduler.ts)
 * and the alert rules (./alerts.ts) - so "restart" means the same thing however
 * it was triggered, and a new action only has to be taught once.
 *
 * Deliberately imports nothing from either caller: scheduler -> actions and
 * alerts -> actions, never the other way round.
 */
import { processManager } from './processManager'
import { createBackup, pruneBackups } from './backups'
import * as rcon from './rcon'
import type { ScheduleAction } from '@shared/types'

/** Backups made by automation are capped so they cannot fill the disk. */
const AUTO_BACKUP_KEEP = 10

/**
 * Run one action. Throws on failure - the caller decides how that is recorded.
 * Actions that need a live server are no-ops when it is not running (the
 * process manager already guards start/stop/restart the same way).
 */
export async function runAction(
  serverId: string,
  action: ScheduleAction,
  payload?: string
): Promise<void> {
  switch (action) {
    case 'restart':
      await processManager.restart(serverId)
      break
    case 'stop':
      await processManager.stop(serverId)
      break
    case 'start':
      await processManager.start(serverId)
      break
    case 'backup':
      await createBackup(serverId, { kind: 'world' })
      pruneBackups(serverId, AUTO_BACKUP_KEEP)
      break
    case 'command':
      // Prefer RCON: it answers, and it works while stdin is busy.
      if (rcon.isConnected(serverId)) await rcon.command(serverId, payload ?? '')
      else if (processManager.isRunning(serverId)) processManager.sendCommand(serverId, payload ?? '')
      break
    case 'broadcast':
      if (processManager.isRunning(serverId)) processManager.sendCommand(serverId, `say ${payload ?? ''}`)
      break
  }
}
