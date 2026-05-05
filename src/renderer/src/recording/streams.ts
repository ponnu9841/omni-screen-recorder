// Helpers that turn an Electron desktopCapturer source into a MediaStream.
// We use the legacy `chromeMediaSource: 'desktop'` constraint instead of
// `getDisplayMedia()` because the latter forces a single-screen picker, while
// this path lets us open one independent stream per display ID — which is the
// whole point of multi-screen capture.
//
// Mouse cursor is rendered into the captured frames by Chromium when using the
// 'desktop' source type, so cursor movement is recorded without extra work.

export type SystemAudioCaptureMode = 'off' | 'per-screen' | 'first-screen'

export interface ScreenStreamOptions {
  sourceId: string
  withSystemAudio: boolean
  maxFps?: number
}

interface ChromeMandatory {
  chromeMediaSource: 'desktop'
  chromeMediaSourceId: string
  minFrameRate?: number
  maxFrameRate?: number
}

// Chromium-specific constraint shape that TypeScript's lib.dom doesn't know
// about. We build the object as `unknown` and cast at the boundary.
function buildConstraints(opts: ScreenStreamOptions): MediaStreamConstraints {
  const videoMandatory: ChromeMandatory = {
    chromeMediaSource: 'desktop',
    chromeMediaSourceId: opts.sourceId,
    minFrameRate: 30,
    maxFrameRate: opts.maxFps ?? 30
  }
  const audioMandatory: ChromeMandatory | null = opts.withSystemAudio
    ? { chromeMediaSource: 'desktop', chromeMediaSourceId: opts.sourceId }
    : null
  return {
    audio: audioMandatory ? ({ mandatory: audioMandatory } as unknown as MediaTrackConstraints) : false,
    video: { mandatory: videoMandatory } as unknown as MediaTrackConstraints
  }
}

export async function captureScreenStream(opts: ScreenStreamOptions): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia(buildConstraints(opts))
}

export async function captureMicStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: false
  })
}

// Mix any number of audio tracks into a single output MediaStream.
// Used for combined-mode recordings, where we need one composite audio track
// alongside the canvas video track.
export function mixAudioTracks(tracks: MediaStreamTrack[]): {
  stream: MediaStream
  context: AudioContext
} {
  const context = new AudioContext()
  const dest = context.createMediaStreamDestination()
  for (const t of tracks) {
    if (t.readyState === 'ended') continue
    const src = context.createMediaStreamSource(new MediaStream([t]))
    src.connect(dest)
  }
  return { stream: dest.stream, context }
}

export function stopStream(stream: MediaStream | null | undefined): void {
  if (!stream) return
  for (const track of stream.getTracks()) {
    try {
      track.stop()
    } catch {
      // ignore
    }
  }
}
