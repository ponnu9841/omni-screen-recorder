import { useEffect, useLayoutEffect, useState } from 'react'

export interface TourStep {
  selector: string
  title: string
  body: string
}

interface Props {
  steps: TourStep[]
  onClose: (reason: 'finished' | 'skipped') => void
}

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

const PAD = 8
const TOOLTIP_W = 320
const TOOLTIP_GAP = 14

function readRect(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 }
}

export default function Tour({ steps, onClose }: Props): React.JSX.Element | null {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)

  const step = steps[index]

  useLayoutEffect(() => {
    if (!step) return
    let raf = 0
    const update = (): void => {
      const el = document.querySelector(step.selector)
      if (!el) {
        setRect(null)
        return
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // Wait a frame so any scroll has settled before measuring.
      raf = requestAnimationFrame(() => setRect(readRect(el)))
    }
    update()
    const onResize = (): void => {
      const el = document.querySelector(step.selector)
      if (el) setRect(readRect(el))
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onResize, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize, true)
    }
  }, [step])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose('skipped')
      else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (index < steps.length - 1) setIndex(index + 1)
        else onClose('finished')
      } else if (e.key === 'ArrowLeft') {
        if (index > 0) setIndex(index - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, steps.length, onClose])

  if (!step) return null

  const vw = window.innerWidth
  const vh = window.innerHeight

  // Place tooltip below if room, else above. Clamp horizontally.
  let tipTop = vh / 2 - 80
  let tipLeft = vw / 2 - TOOLTIP_W / 2
  if (rect) {
    const below = rect.top + rect.height + TOOLTIP_GAP
    const above = rect.top - TOOLTIP_GAP - 160
    tipTop = below + 200 < vh ? below : Math.max(16, above)
    tipLeft = Math.min(
      Math.max(16, rect.left + rect.width / 2 - TOOLTIP_W / 2),
      vw - TOOLTIP_W - 16
    )
  }

  return (
    <div className="tour" role="dialog" aria-label="Getting started">
      {rect ? (
        <>
          <div className="tour-mask top" style={{ height: Math.max(0, rect.top) }} />
          <div
            className="tour-mask bottom"
            style={{ top: rect.top + rect.height, height: Math.max(0, vh - rect.top - rect.height) }}
          />
          <div
            className="tour-mask left"
            style={{ top: rect.top, height: rect.height, width: Math.max(0, rect.left) }}
          />
          <div
            className="tour-mask right"
            style={{
              top: rect.top,
              left: rect.left + rect.width,
              height: rect.height,
              width: Math.max(0, vw - rect.left - rect.width)
            }}
          />
          <div
            className="tour-ring"
            style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          />
        </>
      ) : (
        <div className="tour-mask full" />
      )}

      <div className="tour-tip" style={{ top: tipTop, left: tipLeft, width: TOOLTIP_W }}>
        <div className="tour-tip-head">
          <span className="tour-progress">
            Step {index + 1} of {steps.length}
          </span>
          <button className="tour-skip" onClick={() => onClose('skipped')}>
            Skip
          </button>
        </div>
        <div className="tour-tip-title">{step.title}</div>
        <div className="tour-tip-body">{step.body}</div>
        <div className="tour-tip-actions">
          <button onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}>
            Back
          </button>
          {index < steps.length - 1 ? (
            <button className="primary" onClick={() => setIndex(index + 1)}>
              Next
            </button>
          ) : (
            <button className="primary" onClick={() => onClose('finished')}>
              Got it
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
