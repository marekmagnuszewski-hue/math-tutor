import { useRef, useState } from 'react'
import DrawingCanvas, { type CanvasHandle } from './DrawingCanvas'
import { TRAINING_STEPS, saveTrainingEntry } from '../lib/trainingData'
import { apiUrl } from '../lib/api'

interface Props {
  onComplete: () => void
}

export default function TrainingMode({ onComplete }: Props) {
  const canvasRef = useRef<CanvasHandle>(null)
  const [step, setStep] = useState(0)
  const [hasDrawn, setHasDrawn] = useState(false)
  const [recognized, setRecognized] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [correcting, setCorrecting] = useState(false)
  const [correction, setCorrection] = useState('')

  const current = TRAINING_STEPS[step]
  const progress = Math.round((step / TRAINING_STEPS.length) * 100)

  const handleClear = () => {
    canvasRef.current?.clear(false)
    setHasDrawn(false)
    setRecognized(null)
    setError(null)
    setCorrecting(false)
  }

  const handleRecognize = async () => {
    const img = canvasRef.current?.getImageBase64()
    if (!img) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(apiUrl('/api/recognize'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: img }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setRecognized(data.latex?.trim() ?? '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }

  const advance = () => {
    if (step + 1 >= TRAINING_STEPS.length) {
      onComplete()
    } else {
      setStep(s => s + 1)
      canvasRef.current?.clear(false)
      setHasDrawn(false)
      setRecognized(null)
      setError(null)
      setCorrecting(false)
    }
  }

  const handleConfirm = () => {
    if (recognized === null) return
    saveTrainingEntry({ target: current.target, recognized, confirmed: recognized })
    advance()
  }

  const handleSaveCorrection = () => {
    saveTrainingEntry({ target: current.target, recognized: recognized ?? '', confirmed: correction })
    setCorrecting(false)
    advance()
  }

  return (
    <div className="training-layout">
      <div className="training-header">
        <div className="brand">
          <div className="mark">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
              <line x1="5" y1="12" x2="19" y2="12"/><line x1="12" y1="5" x2="12" y2="19"/>
            </svg>
          </div>
          <div className="name">Math<b>Tutor</b> — Calibration</div>
        </div>
        <span className="training-progress-text">{step + 1} / {TRAINING_STEPS.length}</span>
      </div>

      <div className="training-body">
        <div className="training-instruction">
          <p className="instruction-label">{current.instruction}</p>
          <div className="instruction-display">{current.display}</div>
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
          {!hasDrawn && <div className="placeholder" style={{ fontSize: 18 }}>Write here</div>}
        </div>

        <div className="training-controls">
          {!recognized && !correcting && (
            <div className="training-actions">
              <button className="btn btn-ghost" onClick={handleClear} disabled={!hasDrawn}>Clear</button>
              <button className="btn btn-primary" onClick={handleRecognize} disabled={!hasDrawn || loading}>
                {loading ? 'Recognizing…' : 'Recognize'}
              </button>
            </div>
          )}

          {error && <p style={{ color: 'var(--orange-strong)', fontSize: 14, fontWeight: 700 }}>{error}</p>}

          {recognized !== null && !correcting && (
            <div className="recognition-result">
              <p className="result-label">Recognized as:</p>
              <span className="result-value">{recognized || '(nothing)'}</span>
              <div className="training-actions">
                <button className="btn btn-secondary" onClick={() => { setCorrection(recognized ?? ''); setCorrecting(true) }}>
                  Wrong — fix it
                </button>
                <button className="btn btn-primary" onClick={handleConfirm}>Correct ✓</button>
              </div>
            </div>
          )}

          {correcting && (
            <div className="correction-area">
              <label className="edit-label">Type the correct value:</label>
              <input
                className="edit-input"
                value={correction}
                onChange={e => setCorrection(e.target.value)}
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleSaveCorrection()}
              />
              <div className="training-actions">
                <button className="btn btn-secondary" onClick={() => setCorrecting(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleSaveCorrection}>Save</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="training-progress-bar">
        <div className="training-progress-fill" style={{ width: `${progress}%` }} />
      </div>
    </div>
  )
}
