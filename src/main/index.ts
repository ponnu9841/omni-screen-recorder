import { app, shell, BrowserWindow, ipcMain, screen, dialog } from 'electron'
import path, { join } from 'path'
import { promises as fs } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getDisplays, getScreenSources } from './displays'

const IPC = {
  GET_DISPLAYS: 'GET_DISPLAYS',
  GET_SOURCES: 'GET_SOURCES',
  CHOOSE_SAVE_DIR: 'CHOOSE_SAVE_DIR',
  SAVE_FILE: 'SAVE_FILE',
  CREATE_SESSION_DIR: 'CREATE_SESSION_DIR',
  OPEN_PATH: 'OPEN_PATH',
  DISPLAYS_CHANGED: 'DISPLAYS_CHANGED'
} as const

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../../build/icon.ico'),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

function registerIpc(): void {
  ipcMain.handle(IPC.GET_DISPLAYS, () => getDisplays())
  ipcMain.handle(IPC.GET_SOURCES, () => getScreenSources())

  ipcMain.handle(IPC.CHOOSE_SAVE_DIR, async () => {
    const r = await dialog.showOpenDialog({
      title: 'Choose recording output folder',
      properties: ['openDirectory', 'createDirectory']
    })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle(
    IPC.SAVE_FILE,
    async (_e, payload: { dir: string; filename: string; data: ArrayBuffer }) => {
      if (!payload?.dir || !payload?.filename) throw new Error('SAVE_FILE: missing dir/filename')
      // Strip path separators from filename so the renderer cannot escape the chosen dir.
      const safeName = payload.filename.replace(/[\\/]/g, '_')
      const target = join(payload.dir, safeName)
      await fs.writeFile(target, Buffer.from(payload.data))
      return target
    }
  )

  ipcMain.handle(IPC.CREATE_SESSION_DIR, async (_e, baseDir: string, name: string) => {
    if (!baseDir || !name) throw new Error('CREATE_SESSION_DIR: missing baseDir/name')
    const safeName = name.replace(/[\\/:*?"<>|]/g, '_')
    const target = join(baseDir, safeName)
    await fs.mkdir(target, { recursive: true })
    return target
  })

  ipcMain.handle(IPC.OPEN_PATH, async (_e, target: string) => {
    if (!target) return
    await shell.openPath(target)
  })
}

function broadcastDisplays(): void {
  const displays = getDisplays()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.DISPLAYS_CHANGED, displays)
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpc()
  createWindow()

  // Notify renderer when displays are added/removed/resized so the UI can
  // refresh its selectable list mid-session.
  screen.on('display-added', broadcastDisplays)
  screen.on('display-removed', broadcastDisplays)
  screen.on('display-metrics-changed', broadcastDisplays)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
