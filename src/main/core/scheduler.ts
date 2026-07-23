import { Cron } from 'croner'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { schedulesPath } from '../paths'
import { runAction } from './actions'
import * as events from './events'
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
    await runAction(task.serverId, task.action, task.payload)
    events.record(task.serverId, 'schedule.run', {
      data: { action: task.action },
      text: task.name
    })
  } catch (err) {
    log.warn(`Scheduled task "${task.name}" failed:`, err)
    events.record(task.serverId, 'schedule.failed', {
      data: { action: task.action },
      text: `${task.name}: ${String((err as Error)?.message ?? err)}`
    })
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
