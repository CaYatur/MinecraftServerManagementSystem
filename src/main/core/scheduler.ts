import { Cron } from 'croner'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { schedulesPath } from '../paths'
import { processManager } from './processManager'
import { createBackup, pruneBackups } from './backups'
import * as rcon from './rcon'
import { log } from '../logger'
import type { ScheduleTask } from '@shared/types'

const jobs = new Map<string, Cron>()
let tasks: ScheduleTask[] = []

function load(): void {
  try {
    tasks = JSON.parse(readFileSync(schedulesPath(), 'utf-8')) as ScheduleTask[]
  } catch {
    tasks = []
  }
}
function save(): void {
  writeFileSync(schedulesPath(), JSON.stringify(tasks, null, 2), 'utf-8')
}

async function run(task: ScheduleTask): Promise<void> {
  log.info(`Scheduled task "${task.name}" -> ${task.action}`)
  try {
    switch (task.action) {
      case 'restart':
        await processManager.restart(task.serverId)
        break
      case 'stop':
        await processManager.stop(task.serverId)
        break
      case 'start':
        await processManager.start(task.serverId)
        break
      case 'backup':
        await createBackup(task.serverId, { kind: 'world' })
        pruneBackups(task.serverId, 10)
        break
      case 'command':
        if (rcon.isConnected(task.serverId)) await rcon.command(task.serverId, task.payload ?? '')
        else if (processManager.isRunning(task.serverId))
          processManager.sendCommand(task.serverId, task.payload ?? '')
        break
      case 'broadcast':
        if (processManager.isRunning(task.serverId))
          processManager.sendCommand(task.serverId, `say ${task.payload ?? ''}`)
        break
    }
  } catch (err) {
    log.warn(`Scheduled task "${task.name}" failed:`, err)
  }
  task.lastRun = Date.now()
  task.nextRun = jobs.get(task.id)?.nextRun()?.getTime()
  save()
}

function unschedule(id: string): void {
  const j = jobs.get(id)
  if (j) {
    j.stop()
    jobs.delete(id)
  }
}

function schedule(task: ScheduleTask): void {
  unschedule(task.id)
  if (!task.enabled) {
    task.nextRun = undefined
    return
  }
  try {
    const job = new Cron(task.cron, () => void run(task))
    jobs.set(task.id, job)
    task.nextRun = job.nextRun()?.getTime()
  } catch (err) {
    log.warn(`Invalid cron "${task.cron}" for task ${task.name}:`, err)
  }
}

export function initScheduler(): void {
  load()
  for (const t of tasks) schedule(t)
  save()
}

export function listTasks(): ScheduleTask[] {
  return tasks
}

export type NewTask = Pick<ScheduleTask, 'serverId' | 'name' | 'cron' | 'action'> &
  Partial<Pick<ScheduleTask, 'payload' | 'enabled'>>

export function createTask(input: NewTask): ScheduleTask {
  const task: ScheduleTask = {
    id: randomUUID(),
    enabled: input.enabled ?? true,
    serverId: input.serverId,
    name: input.name,
    cron: input.cron,
    action: input.action,
    payload: input.payload
  }
  tasks.push(task)
  schedule(task)
  save()
  return task
}

export function updateTask(id: string, patch: Partial<ScheduleTask>): ScheduleTask {
  const task = tasks.find((t) => t.id === id)
  if (!task) throw new Error('task-not-found')
  Object.assign(task, patch, { id })
  schedule(task)
  save()
  return task
}

export function deleteTask(id: string): void {
  unschedule(id)
  tasks = tasks.filter((t) => t.id !== id)
  save()
}

export function runTaskNow(id: string): void {
  const task = tasks.find((t) => t.id === id)
  if (task) void run(task)
}

export function stopAllJobs(): void {
  for (const id of [...jobs.keys()]) unschedule(id)
}
