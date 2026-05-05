import { useEffect, useState } from 'react'

interface Props {
  startedAt: number | null
  paused: boolean
}

function format(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export default function Duration({ startedAt, paused }: Props): React.JSX.Element {
  const [now, setNow] = useState<number>(Date.now())
  const [accumulated, setAccumulated] = useState<number>(0)
  const [pauseStart, setPauseStart] = useState<number | null>(null)

  useEffect(() => {
    if (!startedAt || paused) return
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [startedAt, paused])

  useEffect(() => {
    if (paused) {
      setPauseStart(Date.now())
    } else if (pauseStart !== null) {
      setAccumulated((a) => a + (Date.now() - pauseStart))
      setPauseStart(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused])

  useEffect(() => {
    if (startedAt === null) {
      setAccumulated(0)
      setPauseStart(null)
    }
  }, [startedAt])

  const elapsed = startedAt
    ? now - startedAt - accumulated - (pauseStart ? now - pauseStart : 0)
    : 0
  return <span className="duration">{format(Math.max(0, elapsed))}</span>
}
