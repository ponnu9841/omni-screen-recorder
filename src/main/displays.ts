import { screen, desktopCapturer, Display } from 'electron'

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

function toDisplayInfo(d: Display, primaryId: number): DisplayInfo {
  return {
    id: String(d.id),
    label: d.label || `Display ${d.id}`,
    primary: d.id === primaryId,
    internal: d.internal,
    bounds: { ...d.bounds },
    size: { ...d.size },
    scaleFactor: d.scaleFactor,
    rotation: d.rotation
  }
}

export function getDisplays(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((d) => toDisplayInfo(d, primaryId))
}

// desktopCapturer returns a `display_id` per source which corresponds to the
// numeric Electron Display.id stringified. We use that to match each capturable
// source back to its physical display so the UI can show real metadata.
export async function getScreenSources(): Promise<ScreenSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: false
  })
  const displays = getDisplays()
  const byId = new Map(displays.map((d) => [d.id, d]))
  return sources.map((s) => ({
    sourceId: s.id,
    displayId: s.display_id,
    name: s.name || byId.get(s.display_id)?.label || 'Screen',
    thumbnailDataUrl: s.thumbnail.toDataURL(),
    display: byId.get(s.display_id) ?? null
  }))
}
