import { app } from 'electron'
import semver from 'semver'
import { httpJson } from './net'
import type { UpdateInfo } from '@shared/types'

const RELEASES_API =
  'https://api.github.com/repos/CaYatur/MinecraftServerManagementSystem/releases/latest'

/** Compare the running version against the latest GitHub release. */
export async function checkForUpdates(): Promise<UpdateInfo> {
  const current = app.getVersion()
  try {
    const r = await httpJson<{ tag_name: string; html_url: string }>(RELEASES_API, 10000)
    const latest = (r.tag_name || '').replace(/^v/, '')
    const available = !!semver.valid(latest) && semver.gt(latest, current)
    return { current, latest, available, url: r.html_url }
  } catch {
    return { current, available: false }
  }
}
