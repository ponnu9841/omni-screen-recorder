import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import logo from '../../../build/icon.png'
import type { ScreenSource } from '../../preload/api'
import ScreenSelector from './components/ScreenSelector'
import Duration from './components/Duration'
import Tour, { TourStep } from './components/Tour'
import {
  AudioOptions,
  MultiScreenRecorder,
  RecorderState,
  RecordingMode
} from './recording/recorder'
import { CombinedLayout } from './recording/combined'

interface Notice {
  kind: 'info' | 'error' | 'success'
  text: string
}

const TOUR_STEPS: TourStep[] = [
  {
    selector: '[data-tour="displays"]',
    title: '1. Select displays',
    body: 'Click the screens you want to record. You can pick more than one — each becomes part of the session.'
  },
  {
    selector: '[data-tour="options"]',
    title: '2. Configure recording',
    body: 'Choose separate files (one per screen) or a combined file, and pick which audio sources to capture.'
  },
  {
    selector: '[data-tour="output"]',
    title: '3. Choose output folder',
    body: 'Pick a base folder. Each recording is saved inside its own session-… subfolder so files stay organized.'
  },
  {
    selector: '[data-tour="start"]',
    title: '4. Start recording',
    body: 'Hit Start when you are ready. Pause, resume, or stop any time from the controls bar.'
  }
]

const TOUR_STORAGE_KEY = 'omni.tourSeen.v1'

function tourSeenInitial(): boolean {
  try {
    return !localStorage.getItem(TOUR_STORAGE_KEY)
  } catch {
    return false
  }
}

function App(): React.JSX.Element {
  const [sources, setSources] = useState<ScreenSource[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<RecordingMode>('separate')
  const [layout, setLayout] = useState<CombinedLayout>('grid')
  const [audio, setAudio] = useState<AudioOptions>({ mic: true, system: true })
  const [saveDir, setSaveDir] = useState<string | null>(null)
  const [openWhenDone, setOpenWhenDone] = useState<boolean>(true)
  const [state, setState] = useState<RecorderState>('idle')
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [savedFiles, setSavedFiles] = useState<string[]>([])
  const [lastSessionDir, setLastSessionDir] = useState<string | null>(null)
  const [showTour, setShowTour] = useState<boolean>(tourSeenInitial)

  const recorderRef = useRef<MultiScreenRecorder | null>(null)

  const closeTour = useCallback((): void => {
    setShowTour(false)
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, '1')
    } catch {
      /* ignore */
    }
  }, [])

  const replayTour = (): void => setShowTour(true)

  const refreshSources = useCallback(async () => {
    try {
      const list = await window.api.getSources()
      setSources(list)
      setSelected((prev) => {
        const next = new Set<string>()
        for (const s of list) if (prev.has(s.sourceId)) next.add(s.sourceId)
        return next
      })
    } catch (e) {
      setNotice({ kind: 'error', text: `Failed to enumerate screens: ${(e as Error).message}` })
    }
  }, [])

  useEffect(() => {
    void refreshSources()
    const off = window.api.onDisplaysChanged(() => {
      void refreshSources()
    })
    return off
  }, [refreshSources])

  const toggleSelect = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = (): void => setSelected(new Set(sources.map((s) => s.sourceId)))
  const clearSel = (): void => setSelected(new Set())

  const chooseDir = async (): Promise<void> => {
    const dir = await window.api.chooseSaveDir()
    if (dir) setSaveDir(dir)
  }

  const selectedSources = useMemo(
    () => sources.filter((s) => selected.has(s.sourceId)),
    [sources, selected]
  )

  const recording = state === 'recording' || state === 'paused' || state === 'stopping'
  const canStart = state === 'idle' && selectedSources.length > 0 && !!saveDir

  const start = async (): Promise<void> => {
    if (!saveDir) {
      setNotice({ kind: 'error', text: 'Choose a save directory first.' })
      return
    }
    if (selectedSources.length === 0) {
      setNotice({ kind: 'error', text: 'Select at least one screen.' })
      return
    }
    setNotice(null)
    setSavedFiles([])
    setLastSessionDir(null)

    const recorder = new MultiScreenRecorder({
      sources: selectedSources,
      mode,
      layout,
      audio,
      saveDir,
      onStateChange: setState,
      onError: (sourceId, err) => {
        const msg = err instanceof Error ? err.message : String(err)
        setNotice({
          kind: 'error',
          text: sourceId ? `Source ${sourceId}: ${msg}` : `Recording: ${msg}`
        })
      }
    })
    recorderRef.current = recorder

    try {
      await recorder.start()
      setStartedAt(Date.now())
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setNotice({
        kind: 'error',
        text: msg.includes('Permission')
          ? 'Permission denied. Allow screen and microphone access.'
          : `Could not start: ${msg}`
      })
      recorderRef.current = null
    }
  }

  const stop = async (): Promise<void> => {
    const rec = recorderRef.current
    if (!rec) return
    try {
      const result = await rec.stop()
      setStartedAt(null)
      setSavedFiles(result.files)
      setLastSessionDir(result.sessionDir)
      if (result.failures.length > 0) {
        setNotice({
          kind: 'error',
          text: `Saved ${result.files.length} file(s). ${result.failures.length} failure(s): ${result.failures
            .map((f) => f.reason)
            .join('; ')}`
        })
      } else if (result.files.length > 0) {
        setNotice({
          kind: 'success',
          text: `Saved ${result.files.length} file(s) to session folder.`
        })
        if (openWhenDone && result.sessionDir) {
          void window.api.openPath(result.sessionDir)
        }
      }
    } catch (e) {
      setNotice({ kind: 'error', text: `Stop failed: ${(e as Error).message}` })
    } finally {
      recorderRef.current = null
    }
  }

  const togglePause = (): void => {
    const rec = recorderRef.current
    if (!rec) return
    if (state === 'recording') rec.pause()
    else if (state === 'paused') rec.resume()
  }

  const stateLabel: Record<RecorderState, string> = {
    idle: 'Idle',
    starting: 'Starting',
    recording: 'Recording',
    paused: 'Paused',
    stopping: 'Saving',
    error: 'Error'
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <img src={logo} alt="" aria-hidden="true" className="brand-mark" />
          <div>
            <h1>Omni Screen Recorder</h1>
            <p className="subtitle">Capture one or many displays in a single session.</p>
          </div>
        </div>
        <div className="header-right">
          <button className="ghost" onClick={replayTour} title="Show the getting-started guide">
            ? Guide
          </button>
          <div className="status">
            <span className={`dot ${state}`} />
            <span className="state-label">{stateLabel[state]}</span>
            <Duration startedAt={startedAt} paused={state === 'paused'} />
          </div>
        </div>
      </header>

      <main className="workspace">
        <section className="panel displays-panel" data-tour="displays">
          <div className="panel-head">
            <div>
              <h2>1 · Displays</h2>
              <p className="panel-hint">
                {selectedSources.length === 0
                  ? 'Click a card to include that screen in the recording.'
                  : `${selectedSources.length} of ${sources.length} selected.`}
              </p>
            </div>
            <div className="row">
              <button onClick={() => void refreshSources()} disabled={recording}>
                Refresh
              </button>
              <button onClick={selectAll} disabled={recording || sources.length === 0}>
                Select all
              </button>
              <button onClick={clearSel} disabled={recording || selected.size === 0}>
                Clear
              </button>
            </div>
          </div>
          <div className="panel-scroll">
            <ScreenSelector
              sources={sources}
              selected={selected}
              onToggle={toggleSelect}
              disabled={recording}
            />
          </div>
        </section>

        <aside className="side">
          <section className="panel" data-tour="options">
            <div className="panel-head">
              <div>
                <h2>2 · Options</h2>
                <p className="panel-hint">Output format and audio sources.</p>
              </div>
            </div>
            <div className="options">
              <fieldset disabled={recording}>
                <legend>Mode</legend>
                <label>
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === 'separate'}
                    onChange={() => setMode('separate')}
                  />
                  Separate files (one per screen)
                </label>
                <label>
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === 'combined'}
                    onChange={() => setMode('combined')}
                  />
                  Combined (single file)
                </label>
                {mode === 'combined' && (
                  <div className="sub">
                    <label>
                      <input
                        type="radio"
                        name="layout"
                        checked={layout === 'grid'}
                        onChange={() => setLayout('grid')}
                      />
                      Grid
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="layout"
                        checked={layout === 'side-by-side'}
                        onChange={() => setLayout('side-by-side')}
                      />
                      Side-by-side
                    </label>
                  </div>
                )}
              </fieldset>

              <fieldset disabled={recording}>
                <legend>Audio</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={audio.mic}
                    onChange={(e) => setAudio((a) => ({ ...a, mic: e.target.checked }))}
                  />
                  Microphone
                </label>
                {/* <label>
                  <input
                    type="checkbox"
                    checked={audio.system}
                    onChange={(e) => setAudio((a) => ({ ...a, system: e.target.checked }))}
                  />
                  System audio (Windows)
                </label> */}
              </fieldset>

              <fieldset disabled={recording}>
                <legend>After recording</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={openWhenDone}
                    onChange={(e) => setOpenWhenDone(e.target.checked)}
                  />
                  Open folder when finished
                </label>
              </fieldset>
            </div>
          </section>

          <section className="panel" data-tour="output">
            <div className="panel-head">
              <div>
                <h2>3 · Output folder</h2>
                <p className="panel-hint">
                  Each recording is saved into a new <code>session-…</code> subfolder.
                </p>
              </div>
              <div className="row">
                <button onClick={() => void chooseDir()} disabled={recording}>
                  {saveDir ? 'Change…' : 'Choose…'}
                </button>
                {saveDir && (
                  <button
                    onClick={() => void window.api.openPath(saveDir)}
                    title="Open in file explorer"
                  >
                    Open
                  </button>
                )}
              </div>
            </div>
            <div className={`path-box ${saveDir ? '' : 'empty'}`}>
              {saveDir ?? 'No folder selected'}
            </div>
          </section>

          {savedFiles.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Last session</h2>
                  {lastSessionDir && <p className="panel-hint">{lastSessionDir}</p>}
                </div>
                {lastSessionDir && (
                  <div className="row">
                    <button onClick={() => void window.api.openPath(lastSessionDir)}>
                      Open folder
                    </button>
                  </div>
                )}
              </div>
              <ul className="files">
                {savedFiles.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </main>

      <footer className="footer">
        {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
        <section className="controls" data-tour="start">
          {state === 'idle' && (
            <button className="primary" disabled={!canStart} onClick={() => void start()}>
              ● Start recording
              {selectedSources.length > 0
                ? ` (${selectedSources.length} screen${selectedSources.length === 1 ? '' : 's'})`
                : ''}
            </button>
          )}
          {(state === 'recording' || state === 'paused') && (
            <>
              <button onClick={togglePause}>{state === 'paused' ? 'Resume' : 'Pause'}</button>
              <button className="danger" onClick={() => void stop()}>
                Stop & save
              </button>
            </>
          )}
          {state === 'starting' && (
            <button className="primary" disabled>
              Starting…
            </button>
          )}
          {state === 'stopping' && (
            <button className="primary" disabled>
              Saving…
            </button>
          )}
        </section>
      </footer>

      {showTour && <Tour steps={TOUR_STEPS} onClose={closeTour} />}
    </div>
  )
}

export default App
