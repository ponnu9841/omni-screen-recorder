// Top-level multi-screen recording orchestrator.
//
// Two strategies, both triggered through the same start()/stop() API:
//
//   Mode A — separate (MVP): one MediaRecorder per screen MediaStream, written
//     out as `screen-{id}-{timestamp}.webm`. Truly simultaneous recording.
//
//   Mode B — combined: every screen's stream is composited onto a single
//     <canvas>, captured via canvas.captureStream(), and recorded as one file.
//
// Audio:
//   - Microphone: a single mic stream is shared across all per-screen recorders
//     in mode A, and mixed into the combined stream in mode B.
//   - System audio: requested per-screen via Chromium's desktop audio
//     constraint (Windows-friendly). Tracks are mixed in mode B; in mode A each
//     per-screen recorder simply uses its own screen's audio track.
//
// Stream-failure handling: each per-screen pipeline is isolated, so if one
// stream errors (e.g. monitor disconnected) we tear that one down, mark it as
// failed in `failures`, and let the rest keep recording.

import type { ScreenSource } from '../../../preload/api'
import { CombinedLayout, CombinedRecorder } from './combined'
import { captureMicStream, captureScreenStream, stopStream } from './streams'

export type RecordingMode = 'separate' | 'combined'

export interface AudioOptions {
  mic: boolean
  system: boolean
}

export interface RecorderOptions {
  sources: ScreenSource[]
  mode: RecordingMode
  layout: CombinedLayout
  audio: AudioOptions
  saveDir: string
  fps?: number
  onStateChange?: (state: RecorderState) => void
  onError?: (sourceId: string | null, err: unknown) => void
}

export type RecorderState = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'error'

interface Pipeline {
  source: ScreenSource
  stream: MediaStream
  recorder: MediaRecorder | null // null in combined mode
  chunks: Blob[]
  failed: boolean
}

interface SaveResult {
  files: string[]
  failures: { sourceId: string; reason: string }[]
}

function timestamp(): string {
  const d = new Date()
  const pad = (n: number, w = 2): string => n.toString().padStart(w, '0')
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ]
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c
  }
  return 'video/webm'
}

export class MultiScreenRecorder {
  private opts: RecorderOptions
  private state: RecorderState = 'idle'
  private pipelines: Pipeline[] = []
  private micStream: MediaStream | null = null
  private combined: CombinedRecorder | null = null
  private failures: { sourceId: string; reason: string }[] = []

  constructor(opts: RecorderOptions) {
    this.opts = opts
  }

  getState(): RecorderState {
    return this.state
  }

  private setState(s: RecorderState): void {
    this.state = s
    this.opts.onStateChange?.(s)
  }

  private fail(sourceId: string | null, err: unknown): void {
    const reason = err instanceof Error ? err.message : String(err)
    if (sourceId) this.failures.push({ sourceId, reason })
    this.opts.onError?.(sourceId, err)
  }

  async start(): Promise<void> {
    if (this.state !== 'idle') throw new Error(`Cannot start from state ${this.state}`)
    if (this.opts.sources.length === 0) throw new Error('No screens selected')
    this.setState('starting')

    try {
      // Mic is shared across all per-screen recorders in separate mode.
      if (this.opts.audio.mic) {
        try {
          this.micStream = await captureMicStream()
        } catch (e) {
          this.fail(null, e)
          this.micStream = null
        }
      }

      // Open a stream per source. We allow individual failures.
      for (const source of this.opts.sources) {
        try {
          const stream = await captureScreenStream({
            sourceId: source.sourceId,
            withSystemAudio: this.opts.audio.system,
            maxFps: this.opts.fps ?? 30
          })

          // If any track unexpectedly ends mid-recording (e.g. display
          // unplugged), record the failure but don't take down siblings.
          for (const t of stream.getTracks()) {
            t.addEventListener('ended', () => {
              if (this.state === 'recording' || this.state === 'paused') {
                this.fail(source.sourceId, new Error(`Track ended: ${t.kind}`))
                this.tearDownPipeline(source.sourceId)
              }
            })
          }

          this.pipelines.push({ source, stream, recorder: null, chunks: [], failed: false })
        } catch (e) {
          this.fail(source.sourceId, e)
        }
      }

      if (this.pipelines.length === 0) {
        throw new Error('Failed to open any screen streams')
      }

      if (this.opts.mode === 'combined') {
        await this.startCombined()
      } else {
        this.startSeparate()
      }

      this.setState('recording')
    } catch (e) {
      this.setState('error')
      await this.disposeAll()
      throw e
    }
  }

  private startSeparate(): void {
    const mime = pickMimeType()
    for (const p of this.pipelines) {
      // For separate mode, mix the shared mic into this screen's track set so
      // each output file has narration.
      const tracks: MediaStreamTrack[] = [...p.stream.getVideoTracks(), ...p.stream.getAudioTracks()]
      if (this.micStream) tracks.push(...this.micStream.getAudioTracks())
      const out = new MediaStream(tracks)

      const rec = new MediaRecorder(out, {
        mimeType: mime,
        videoBitsPerSecond: 6_000_000
      })
      rec.ondataavailable = (e): void => {
        if (e.data && e.data.size > 0) p.chunks.push(e.data)
      }
      rec.onerror = (ev): void => this.fail(p.source.sourceId, (ev as ErrorEvent).error)
      rec.start(1000)
      p.recorder = rec
    }
  }

  private async startCombined(): Promise<void> {
    const audioTracks: MediaStreamTrack[] = []
    if (this.micStream) audioTracks.push(...this.micStream.getAudioTracks())
    if (this.opts.audio.system) {
      for (const p of this.pipelines) audioTracks.push(...p.stream.getAudioTracks())
    }
    this.combined = new CombinedRecorder({
      screenStreams: this.pipelines.map((p) => p.stream),
      audioTracks,
      layout: this.opts.layout,
      fps: this.opts.fps ?? 30,
      mimeType: pickMimeType()
    })
    await this.combined.start()
  }

  pause(): void {
    if (this.state !== 'recording') return
    if (this.combined) this.combined.pause()
    for (const p of this.pipelines) {
      if (p.recorder?.state === 'recording') p.recorder.pause()
    }
    this.setState('paused')
  }

  resume(): void {
    if (this.state !== 'paused') return
    if (this.combined) this.combined.resume()
    for (const p of this.pipelines) {
      if (p.recorder?.state === 'paused') p.recorder.resume()
    }
    this.setState('recording')
  }

  async stop(): Promise<SaveResult> {
    if (this.state !== 'recording' && this.state !== 'paused') {
      return { files: [], failures: this.failures }
    }
    this.setState('stopping')

    const files: string[] = []
    try {
      if (this.combined) {
        const blob = await this.combined.stop()
        const filename = `combined-${timestamp()}.webm`
        const path = await this.saveBlob(blob, filename)
        files.push(path)
      } else {
        // Stop every per-screen recorder concurrently and save in parallel.
        const saved = await Promise.all(this.pipelines.map((p) => this.stopAndSavePipeline(p)))
        for (const path of saved) if (path) files.push(path)
      }
    } finally {
      await this.disposeAll()
      this.setState('idle')
    }
    return { files, failures: this.failures }
  }

  private stopAndSavePipeline(p: Pipeline): Promise<string | null> {
    return new Promise((resolve) => {
      const rec = p.recorder
      if (!rec || p.failed) return resolve(null)
      const finalize = async (): Promise<void> => {
        try {
          const blob = new Blob(p.chunks, { type: rec.mimeType || 'video/webm' })
          if (blob.size === 0) return resolve(null)
          const filename = `screen-${p.source.displayId}-${timestamp()}.webm`
          const path = await this.saveBlob(blob, filename)
          resolve(path)
        } catch (e) {
          this.fail(p.source.sourceId, e)
          resolve(null)
        }
      }
      rec.onstop = finalize
      if (rec.state !== 'inactive') rec.stop()
      else void finalize()
    })
  }

  private async saveBlob(blob: Blob, filename: string): Promise<string> {
    const buf = await blob.arrayBuffer()
    return window.api.saveFile(this.opts.saveDir, filename, buf)
  }

  private tearDownPipeline(sourceId: string): void {
    const p = this.pipelines.find((x) => x.source.sourceId === sourceId)
    if (!p) return
    p.failed = true
    try {
      if (p.recorder && p.recorder.state !== 'inactive') p.recorder.stop()
    } catch {
      /* ignore */
    }
    stopStream(p.stream)
  }

  private async disposeAll(): Promise<void> {
    for (const p of this.pipelines) stopStream(p.stream)
    stopStream(this.micStream)
    this.micStream = null
    this.combined?.dispose()
    this.combined = null
    this.pipelines = []
  }
}
