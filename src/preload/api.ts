// Types shared by preload (runtime) and renderer (compile-time only).
// Kept in a plain .ts file so both tsconfigs can resolve the named exports.

export interface DisplayInfo {
  id: string
  label: string
  primary: boolean
  internal: boolean
  bounds: { x: number; y: number; width: number; height: number }
  size: { width: number; height: number }
  scaleFactor: number
  rotation: number
}

export interface ScreenSource {
  sourceId: string
  displayId: string
  name: string
  thumbnailDataUrl: string
  display: DisplayInfo | null
}

export interface RecorderApi {
  getDisplays: () => Promise<DisplayInfo[]>
  getSources: () => Promise<ScreenSource[]>
  chooseSaveDir: () => Promise<string | null>
  saveFile: (dir: string, filename: string, data: ArrayBuffer) => Promise<string>
  onDisplaysChanged: (cb: (displays: DisplayInfo[]) => void) => () => void
}
