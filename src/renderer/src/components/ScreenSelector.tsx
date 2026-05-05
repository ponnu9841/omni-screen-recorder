import type { ScreenSource } from '../../../preload/api'

interface Props {
  sources: ScreenSource[]
  selected: Set<string>
  onToggle: (sourceId: string) => void
  disabled?: boolean
}

export default function ScreenSelector({ sources, selected, onToggle, disabled }: Props): React.JSX.Element {
  if (sources.length === 0) {
    return <div className="screens-empty">No displays detected.</div>
  }

  return (
    <div className="screens-grid">
      {sources.map((s) => {
        const isOn = selected.has(s.sourceId)
        const dims = s.display ? `${s.display.size.width}×${s.display.size.height}` : '—'
        const scale = s.display ? `@${s.display.scaleFactor}x` : ''
        return (
          <label
            key={s.sourceId}
            className={`screen-card${isOn ? ' selected' : ''}${disabled ? ' disabled' : ''}`}
          >
            <input
              type="checkbox"
              checked={isOn}
              disabled={disabled}
              onChange={() => onToggle(s.sourceId)}
            />
            <img src={s.thumbnailDataUrl} alt={s.name} className="screen-thumb" />
            <div className="screen-meta">
              <strong>{s.display?.label ?? s.name}</strong>
              <span>
                {dims} {scale}
                {s.display?.primary ? ' · primary' : ''}
              </span>
            </div>
          </label>
        )
      })}
    </div>
  )
}
