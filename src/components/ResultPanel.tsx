import { useEffect, useRef, useState } from 'react'
import katex from 'katex'

interface Props {
  latex: string | null
  loading: boolean
  error: string | null
  onCorrect: (corrected: string) => void
  onNewProblem: () => void
}

export default function ResultPanel({ latex, loading, error, onCorrect, onNewProblem }: Props) {
  const mathRef = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [renderError, setRenderError] = useState(false)

  useEffect(() => {
    if (!latex || !mathRef.current || editing) return
    try {
      katex.render(latex, mathRef.current, {
        displayMode: true,
        throwOnError: false,
        trust: false,
      })
      setRenderError(false)
    } catch {
      setRenderError(true)
    }
  }, [latex, editing])

  const handleStartEdit = () => {
    setEditValue(latex ?? '')
    setEditing(true)
  }

  const handleConfirmEdit = () => {
    onCorrect(editValue)
    setEditing(false)
  }

  return (
    <div className="result-panel">
      <h2 className="panel-title">Recognition</h2>

      <div className="math-display">
        {loading && (
          <div className="status-message loading">
            <span className="spinner" /> Recognizing…
          </div>
        )}

        {error && !loading && (
          <div className="status-message error">{error}</div>
        )}

        {!loading && !error && !latex && (
          <div className="status-message hint">
            Write an equation on the board, then tap <strong>Recognize</strong>
          </div>
        )}

        {latex && !loading && !editing && (
          <>
            {renderError ? (
              <code className="raw-latex">{latex}</code>
            ) : (
              <div ref={mathRef} className="katex-output" />
            )}
            <div className="raw-latex-label">LaTeX: <code>{latex}</code></div>
          </>
        )}

        {editing && (
          <div className="edit-area">
            <label className="edit-label">Correct the LaTeX:</label>
            <input
              className="edit-input"
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleConfirmEdit()}
            />
          </div>
        )}
      </div>

      {latex && !loading && (
        <div className="panel-actions">
          {!editing ? (
            <>
              <button className="btn btn-secondary" onClick={handleStartEdit}>
                Fix recognition
              </button>
              <button className="btn btn-primary" onClick={onNewProblem}>
                Get exercise
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleConfirmEdit}>
                Save correction
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
