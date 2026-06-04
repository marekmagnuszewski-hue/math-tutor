import { useRef, useState } from 'react'
import DrawingCanvas, { type CanvasHandle } from './DrawingCanvas'
import { saveTrainingEntry } from '../lib/trainingData'

// 3 full rounds: 0-9, 0-9, 0-9
const STEPS = Array.from({ length: 30 }, (_, i) => i % 10)
const TOTAL = STEPS.length

interface Props {
  onComplete: () => void
  onBack: () => void
}

export default function NumbersCalibration({ onComplete, onBack }: Props) {
  const canvasRef = useRef<CanvasHandle>(null)
  const [step, setStep] = useState(0)
  const [hasDrawn, setHasDrawn] = useState(false)
  const [loading, setLoading] = useState(false)
  const [finished, setFinished] = useState(false)

  const digit = STEPS[step]
  const roundDisplay = Math.floor(step / 10) + 1   // 1-based for UI
  const round = Math.floor(step / 10)               // 0-based for storage
  const progress = Math.round((step / TOTAL) * 100)

  const handleClear = () => {
    canvasRef.current?.clear(false)
    setHasDrawn(false)
  }

  const handleNext = async () => {
    if (!hasDrawn || loading) return
    const img = canvasRef.current?.getImageBase64()
    if (!img) return

    setLoading(true)
    try {
      const res = await fetch('/api/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: img, mode: 'number' }),
      })
      const data = await res.json()
      const recognized = data.latex?.trim() ?? ''
      // Save with round so all 3 rounds are stored separately.
      // This means if round 1 catches a mismatch (e.g. 7→Z) but round 3
      // gets it right (7→7), both are kept and the hint still fires.
      saveTrainingEntry({ target: String(digit), recognized, confirmed: String(digit), round })
    } catch {
      // Save without recognized value if API fails — won't generate hints but doesn't break
      saveTrainingEntry({ target: String(digit), recognized: '', confirmed: String(digit) })
    } finally {
      setLoading(false)
    }

    const next = step + 1
    if (next >= TOTAL) {
      setFinished(true)
    } else {
      setStep(next)
      canvasRef.current?.clear(false)
      setHasDrawn(false)
    }
  }

  // ── Completion screen ──────────────────────────────────────────────────────
  if (finished) {
    return (
      <div className="training-layout">
        <div className="training-header">
          <div className="brand">
            <span className="name">Math<b>Tutor</b></span>
          </div>
        </div>
        <div className="training-body">
          <div className="calib-done">
            <div className="calib-done-check">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" width="40" height="40">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <p className="calib-done-title">Kalibracja ukończona!</p>
            <p className="calib-done-sub">
              System nauczył się, jak piszesz każdą cyfrę. Rozpoznawanie w ćwiczeniach będzie teraz dokładniejsze.
            </p>
            <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={onComplete}>
              Zacznij ćwiczyć →
            </button>
          </div>
        </div>
        <div className="training-progress-bar">
          <div className="training-progress-fill" style={{ width: '100%' }} />
        </div>
      </div>
    )
  }

  // ── Calibration step ───────────────────────────────────────────────────────
  return (
    <div className="training-layout">
      <div className="training-header">
        <div className="brand">
          <button className="tbtn ghost" style={{ padding: '6px 10px' }} onClick={onBack}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <div className="name">Math<b>Tutor</b> — Kalibracja</div>
        </div>
        <span className="training-progress-text">Runda {roundDisplay} / 3 &nbsp;·&nbsp; {step + 1} / {TOTAL}</span>
      </div>

      <div className="training-body">
        <div className="training-instruction">
          <p className="instruction-label">Napisz liczbę</p>
          <div className="instruction-display">{digit}</div>
        </div>

        <div className="training-canvas-wrap">
          <DrawingCanvas
            ref={canvasRef}
            tool="pen"
            penColor="#2E2820"
            penSize="medium"
            onFirstDraw={() => setHasDrawn(true)}
            onUndoStackChange={() => {}}
          />
          {!hasDrawn && (
            <div className="placeholder" style={{ fontSize: 18 }}>Pisz tutaj</div>
          )}
        </div>

        <div className="training-controls">
          <div className="training-actions">
            <button className="btn btn-ghost" onClick={handleClear} disabled={!hasDrawn}>
              Wyczyść
            </button>
            <button className="btn btn-primary" onClick={handleNext} disabled={!hasDrawn || loading}>
              {loading ? 'Uczę się…' : step + 1 === TOTAL ? 'Zakończ' : 'Dalej →'}
            </button>
          </div>
        </div>
      </div>

      <div className="training-progress-bar">
        <div className="training-progress-fill" style={{ width: `${progress}%` }} />
      </div>
    </div>
  )
}
