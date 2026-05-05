import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScreenSource } from '../../preload/api'
import ScreenSelector from './components/ScreenSelector'
import Duration from './components/Duration'
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

function App(): React.JSX.Element {
  const [sources, setSources] = useState<ScreenSource[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<RecordingMode>('separate')
  const [layout, setLayout] = useState<CombinedLayout>('grid')
  const [audio, setAudio] = useState<AudioOptions>({ mic: true, system: true })
  const [saveDir, setSaveDir] = useState<string | null>(null)
  const [state, setState] = useState<RecorderState>('idle')
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [savedFiles, setSavedFiles] = useState<string[]>([])

  const recorderRef = useRef<MultiScreenRecorder | null>(null)

  const refreshSources = useCallback(async () => {
    try {
      const list = await window.api.getSources()
      setSources(list)
      // Drop selections for screens that no longer exist.
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

  const canStart =
    state === 'idle' && selectedSources.length > 0 && !!saveDir

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
          text: `Saved ${result.files.length} file(s) to ${saveDir}.`
        })
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

  const recording = state === 'recording' || state === 'paused' || state === 'stopping'

  return (
    <div className="app">
      <header className="header">
        <h1>Multi-Screen Recorder</h1>
        <div className="status">
          <span className={`dot ${state}`} />
          <span>{state}</span>
          <Duration startedAt={startedAt} paused={state === 'paused'} />
        </div>
      </header>

      <section className="panel">
        <div className="panel-head">
          <h2>Displays</h2>
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
        <ScreenSelector
          sources={sources}
          selected={selected}
          onToggle={toggleSelect}
          disabled={recording}
        />
      </section>

      <section className="panel">
        <h2>Options</h2>
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
            <label>
              <input
                type="checkbox"
                checked={audio.system}
                onChange={(e) => setAudio((a) => ({ ...a, system: e.target.checked }))}
              />
              System audio (Windows)
            </label>
          </fieldset>

          <fieldset disabled={recording}>
            <legend>Output</legend>
            <button onClick={() => void chooseDir()}>Choose folder…</button>
            <div className="path">{saveDir ?? 'No folder selected'}</div>
          </fieldset>
        </div>
      </section>

      <section className="controls">
        {state === 'idle' && (
          <button className="primary" disabled={!canStart} onClick={() => void start()}>
            Start recording {selectedSources.length > 0 ? `(${selectedSources.length})` : ''}
          </button>
        )}
        {(state === 'recording' || state === 'paused') && (
          <>
            <button onClick={togglePause}>{state === 'paused' ? 'Resume' : 'Pause'}</button>
            <button className="danger" onClick={() => void stop()}>
              Stop
            </button>
          </>
        )}
        {state === 'starting' && <button disabled>Starting…</button>}
        {state === 'stopping' && <button disabled>Saving…</button>}
      </section>

      {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}

      {savedFiles.length > 0 && (
        <section className="panel">
          <h2>Saved files</h2>
          <ul className="files">
            {savedFiles.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export default App
