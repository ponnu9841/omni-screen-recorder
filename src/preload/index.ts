import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

import type { DisplayInfo, ScreenSource, RecorderApi } from './api'

const api: RecorderApi = {
  getDisplays: () => ipcRenderer.invoke('GET_DISPLAYS') as Promise<DisplayInfo[]>,
  getSources: () => ipcRenderer.invoke('GET_SOURCES') as Promise<ScreenSource[]>,
  chooseSaveDir: () => ipcRenderer.invoke('CHOOSE_SAVE_DIR') as Promise<string | null>,
  saveFile: (dir, filename, data) =>
    ipcRenderer.invoke('SAVE_FILE', { dir, filename, data }) as Promise<string>,
  createSessionDir: (baseDir, name) =>
    ipcRenderer.invoke('CREATE_SESSION_DIR', baseDir, name) as Promise<string>,
  openPath: (target) => ipcRenderer.invoke('OPEN_PATH', target) as Promise<void>,
  onDisplaysChanged: (cb) => {
    const handler = (_e: IpcRendererEvent, d: DisplayInfo[]): void => cb(d)
    ipcRenderer.on('DISPLAYS_CHANGED', handler)
    return () => ipcRenderer.removeListener('DISPLAYS_CHANGED', handler)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
