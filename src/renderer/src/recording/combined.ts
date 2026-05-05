// Compose multiple screen MediaStreams into a single video track via an
// offscreen <canvas>, optionally with mixed audio. The canvas is driven by
// requestAnimationFrame and exposed as a MediaStream via canvas.captureStream.
//
// Layouts:
//   - 'side-by-side' : single horizontal row (good for 2 screens)
//   - 'grid'         : as-square-as-possible grid for any N

import { mixAudioTracks } from './streams'

export type CombinedLayout = 'side-by-side' | 'grid'

export interface CombinedRecorderOptions {
  screenStreams: MediaStream[]
  audioTracks: MediaStreamTrack[] // mic + system, already gathered
  layout: CombinedLayout
  fps: number
  // Output dimensions cap; per-cell size is derived from this.
  maxWidth?: number
  maxHeight?: number
  mimeType?: string
  videoBitsPerSecond?: number
}

interface Cell {
  video: HTMLVideoElement
  x: number
  y: number
  w: number
  h: number
}

export class CombinedRecorder {
  private opts: CombinedRecorderOptions
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private cells: Cell[] = []
  private rafId = 0
  private mediaRecorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private audioContext: AudioContext | null = null
  private outputStream: MediaStream | null = null
  private running = false

  constructor(opts: CombinedRecorderOptions) {
    this.opts = opts
    this.canvas = document.createElement('canvas')
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('Could not acquire 2D canvas context')
    this.ctx = ctx
  }

  private async layoutCells(): Promise<void> {
    const maxW = this.opts.maxWidth ?? 1920
    const maxH = this.opts.maxHeight ?? 1080
    const n = this.opts.screenStreams.length

    // Build a hidden <video> per stream; we draw from these every frame.
    const videos: HTMLVideoElement[] = []
    for (const stream of this.opts.screenStreams) {
      const v = document.createElement('video')
      v.srcObject = stream
      v.muted = true
      v.playsInline = true
      v.autoplay = true
      await v.play().catch(() => undefined)
      videos.push(v)
    }
    // Wait for each video to know its native dimensions, otherwise the first
    // few frames will be 0x0 and we'll lay things out wrong.
    await Promise.all(
      videos.map(
        (v) =>
          new Promise<void>((resolve) => {
            if (v.videoWidth > 0) return resolve()
            v.onloadedmetadata = (): void => resolve()
          })
      )
    )

    let cols: number
    let rows: number
    if (this.opts.layout === 'side-by-side') {
      cols = n
      rows = 1
    } else {
      cols = Math.ceil(Math.sqrt(n))
      rows = Math.ceil(n / cols)
    }

    const cellW = Math.floor(maxW / cols)
    const cellH = Math.floor(maxH / rows)
    this.canvas.width = cellW * cols
    this.canvas.height = cellH * rows

    this.cells = videos.map((video, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      return { video, x: col * cellW, y: row * cellH, w: cellW, h: cellH }
    })
  }

  // Letterbox each video into its cell to preserve aspect ratio.
  private drawFrame = (): void => {
    if (!this.running) return
    this.ctx.fillStyle = '#000'
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    for (const c of this.cells) {
      const v = c.video
      if (v.readyState < 2 || v.videoWidth === 0) continue
      const srcAR = v.videoWidth / v.videoHeight
      const dstAR = c.w / c.h
      let dw = c.w
      let dh = c.h
      if (srcAR > dstAR) {
        dh = Math.floor(c.w / srcAR)
      } else {
        dw = Math.floor(c.h * srcAR)
      }
      const dx = c.x + Math.floor((c.w - dw) / 2)
      const dy = c.y + Math.floor((c.h - dh) / 2)
      this.ctx.drawImage(v, dx, dy, dw, dh)
    }
    this.rafId = requestAnimationFrame(this.drawFrame)
  }

  async start(): Promise<void> {
    await this.layoutCells()

    // Composite output: canvas video track + mixed audio tracks.
    const canvasStream = this.canvas.captureStream(this.opts.fps)
    const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()]
    if (this.opts.audioTracks.length > 0) {
      const { stream, context } = mixAudioTracks(this.opts.audioTracks)
      this.audioContext = context
      tracks.push(...stream.getAudioTracks())
    }
    this.outputStream = new MediaStream(tracks)

    this.mediaRecorder = new MediaRecorder(this.outputStream, {
      mimeType: this.opts.mimeType ?? 'video/webm;codecs=vp9,opus',
      videoBitsPerSecond: this.opts.videoBitsPerSecond ?? 8_000_000
    })
    this.mediaRecorder.ondataavailable = (e): void => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data)
    }

    this.running = true
    this.mediaRecorder.start(1000)
    this.rafId = requestAnimationFrame(this.drawFrame)
  }

  pause(): void {
    if (this.mediaRecorder?.state === 'recording') this.mediaRecorder.pause()
  }

  resume(): void {
    if (this.mediaRecorder?.state === 'paused') this.mediaRecorder.resume()
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const rec = this.mediaRecorder
      if (!rec) return reject(new Error('CombinedRecorder not started'))
      rec.onstop = (): void => {
        this.running = false
        cancelAnimationFrame(this.rafId)
        resolve(new Blob(this.chunks, { type: rec.mimeType || 'video/webm' }))
      }
      rec.onerror = (ev): void => reject((ev as ErrorEvent).error ?? new Error('MediaRecorder error'))
      if (rec.state !== 'inactive') rec.stop()
      else resolve(new Blob(this.chunks, { type: rec.mimeType || 'video/webm' }))
    })
  }

  dispose(): void {
    this.running = false
    cancelAnimationFrame(this.rafId)
    for (const c of this.cells) {
      c.video.pause()
      c.video.srcObject = null
    }
    this.cells = []
    this.audioContext?.close().catch(() => undefined)
    this.audioContext = null
    this.outputStream = null
    this.mediaRecorder = null
  }
}
