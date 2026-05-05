import { ElectronAPI } from '@electron-toolkit/preload'
import type { RecorderApi } from './api'

export type { DisplayInfo, ScreenSource, RecorderApi } from './api'

declare global {
  interface Window {
    electron: ElectronAPI
    api: RecorderApi
  }
}
