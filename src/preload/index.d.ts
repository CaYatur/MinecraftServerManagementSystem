import type { MsmsApi } from '@shared/ipc'

declare global {
  interface Window {
    msms: MsmsApi
  }
}

export {}
