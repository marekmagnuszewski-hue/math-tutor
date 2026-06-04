import { useRef, useState, useCallback } from 'react'
import DrawingCanvas, { type CanvasHandle } from './components/DrawingCanvas'
import ExercisePanel from './components/ExercisePanel'
import NumbersCalibration from './components/NumbersCalibration'
import CustomMode from './components/CustomMode'
import { buildHintsText, saveTrainingEntry, clearTrainingData } from './lib/trainingData'
import { generateExercise, type UnitType, type Exercise } from './lib/exerciseGenerator'
import './App.css'

type AppMode = 'landing' | 'basic' | 'moderate' | 'highschool'

const PEN_COLORS = ['#2E2820', '#FF6A2C', '#2C7BE5', '#2FA876']
const SIZE_DOTS = { small: 6, medium: 10, large: 15 }

const UNITS: Array<{ id: UnitType; icon: string; title: string; desc: string }> = [
  { id: 'numbers',        icon: '0–9', title: 'Liczby',         desc: 'Naucz system swojego pisma' },
  { id: 'addition',       icon: '+',   title: 'Dodawanie',      desc: 'Nieograniczone zadania z dodawania' },
  { id: 'subtraction',    icon: '−',   title: 'Odejmowanie',    desc: 'Nieograniczone zadania z odejmowania' },
  { id: 'multiplication', icon: '×',   title: 'Mnożenie',       desc: 'Tabliczka mnożenia' },
  { id: 'division',       icon: '÷',   title: 'Dzielenie',      desc: 'Zadania z dzielenia' },
]

// ── Top-level router ──────────────────────────────────────────────────────────

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>('landing')

  if (appMode === 'landing') return <LandingPage onSelect={setAppMode} />
  if (appMode === 'basic')   return <BasicMode onHome={() => setAppMode('landing')} />
  return <CustomMode mode={appMode as 'moderate' | 'highschool'} onHome={() => setAppMode('landing')} />
}

// ── Landing page ──────────────────────────────────────────────────────────────

function LandingPage({ onSelect }: { onSelect: (m: AppMode) => void }) {
  return (
    <div className="landing">
      <div className="bg-blob a" /><div className="bg-blob b" />
      <header className="landing-header">
        <span className="name">Math<b>Tutor</b></span>
      </header>
      <div className="landing-body">
        <p className="landing-tagline">Wybierz poziom</p>
        <div className="mode-grid">
          <button className="mode-card mode-basic" onClick={() => onSelect('basic')}>
            <div className="mode-icon">＋−×÷</div>
            <div className="mode-title">Podstawowy</div>
            <div className="mode-desc">Arytmetyka — dodawanie, odejmowanie, mnożenie i dzielenie</div>
          </button>
          <button className="mode-card mode-moderate" onClick={() => onSelect('moderate')}>
            <div className="mode-icon">⅔</div>
            <div className="mode-title">Średniozaawansowany</div>
            <div className="mode-desc">Klasy 4–8 · Wgraj własne zadania</div>
          </button>
          <button className="mode-card mode-highschool" onClick={() => onSelect('highschool')}>
            <div className="mode-icon">∫</div>
            <div className="mode-title">Liceum</div>
            <div className="mode-desc">Klasy 1–4 LO · Wgraj własne zadania</div>
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Basic mode ────────────────────────────────────────────────────────────────

function BasicMode({ onHome }: { onHome: () => void }) {
  const canvasRef = useRef<CanvasHandle>(null)
  const [unit, setUnit] = useState<UnitType | null>(null)
  const [tool, setToolState] = useState<'pen' | 'erase'>('pen')
  const [penColor, setPenColor] = useState(PEN_COLORS[0])
  const [penSize, setPenSize] = useState<'small' | 'medium' | 'large'>('medium')
  const [canUndo, setCanUndo] = useState(false)
  const [hasDrawn, setHasDrawn] = useState(false)
  const [exercise, setExercise] = useState<Exercise | null>(null)
  const [solvedCount, setSolvedCount] = useState(0)
  const lastAnswer = useRef<string>('')

  const setTool = useCallback((t: 'pen' | 'erase') => setToolState(t), [])

  const nextExercise = useCallback((u: UnitType) => {
    const ex = generateExercise(u, lastAnswer.current)
    lastAnswer.current = ex.answer
    setExercise(ex)
    canvasRef.current?.clear(false)
    setHasDrawn(false)
  }, [])

  const startUnit = useCallback((u: UnitType) => {
    setUnit(u)
    setSolvedCount(0)
    lastAnswer.current = ''
    if (u !== 'numbers') {
      const ex = generateExercise(u)
      lastAnswer.current = ex.answer
      setExercise(ex)
    }
    setHasDrawn(false)
  }, [])

  const backToUnits = useCallback(() => {
    setUnit(null)
    setExercise(null)
    canvasRef.current?.clear(false)
    setHasDrawn(false)
  }, [])

  const handleCheck = useCallback(async (): Promise<{ correct: boolean | null; recognized: string | null }> => {
    if (!exercise) return { correct: null, recognized: null }
    const img = canvasRef.current?.getImageBase64()
    if (!img) return { correct: null, recognized: null }
    try {
      const recRes = await fetch('/api/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: img, hints: buildHintsText(), mode: 'number' }),
      })
      if (!recRes.ok) return { correct: null, recognized: null }
      const recData = await recRes.json()
      const userLatex = recData.latex?.trim() ?? null
      if (!userLatex) return { correct: null, recognized: null }
      const checkRes = await fetch('/api/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAnswer: userLatex, correctAnswer: exercise.answer }),
      })
      if (!checkRes.ok) return { correct: null, recognized: userLatex }
      const checkData = await checkRes.json()
      return { correct: checkData.equivalent === true, recognized: userLatex }
    } catch {
      return { correct: null, recognized: null }
    }
  }, [exercise])

  const handleTeach = useCallback((recognized: string, confirmed: string) => {
    saveTrainingEntry({ target: confirmed, recognized, confirmed })
  }, [])

  const handleSelfAssess = useCallback((correct: boolean) => {
    if (correct) setSolvedCount(c => c + 1)
  }, [])

  const handleNext = useCallback(() => {
    if (unit) nextExercise(unit)
  }, [unit, nextExercise])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    if (e.key.toLowerCase() === 'p') setTool('pen')
    if (e.key.toLowerCase() === 'e') setTool('erase')
  }, [setTool])

  // ── Numbers calibration ──
  if (unit === 'numbers') {
    return <NumbersCalibration onComplete={backToUnits} onBack={backToUnits} />
  }

  // ── Unit selection ──
  if (!unit) {
    return (
      <div className="app" tabIndex={-1}>
        <div className="bg-blob a" /><div className="bg-blob b" />
        <header className="topbar">
          <button className="brand brand-btn" onClick={onHome}>
            <span className="name">Math<b>Tutor</b></span>
          </button>
        </header>
        <div className="unit-select">
          <p className="unit-select-label">Wybierz ćwiczenie</p>
          <div className="unit-grid">
            {UNITS.map(u => (
              <button key={u.id} className="unit-card" onClick={() => startUnit(u.id)}>
                <div className="unit-icon">{u.icon}</div>
                <div className="unit-title">{u.title}</div>
                <div className="unit-desc">{u.desc}</div>
              </button>
            ))}
          </div>
          <button className="reset-calib-link" title="Usuń dane kalibracji pisma" onClick={() => {
            clearTrainingData()
            alert('Dane kalibracji zostały usunięte. Przejdź do Liczb, aby ponownie skalibrować.')
          }}>
            Zresetuj dane kalibracji
          </button>
        </div>
      </div>
    )
  }

  // ── Exercise screen ──
  return (
    <div className="app" onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="bg-blob a" /><div className="bg-blob b" />

      <header className="topbar">
        <button className="brand brand-btn" onClick={onHome}>
          <span className="name">Math<b>Tutor</b></span>
        </button>

        <div className="toolbar">
          <button className="tbtn ghost" onClick={backToUnits} title="Powrót do modułów">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="19" height="19">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            <span className="lbl">Moduły</span>
          </button>

          <div className="divider" />

          <div className="tool-group">
            <button className={`tbtn ${tool === 'pen' ? 'is-active' : ''}`} onClick={() => setTool('pen')} title="Długopis (P)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="19" height="19">
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
              </svg>
              <span className="lbl">Pisz</span>
            </button>
            <button className={`tbtn ${tool === 'erase' ? 'is-active' : ''}`} onClick={() => setTool('erase')} title="Gumka (E)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="19" height="19">
                <path d="M4 16.5 9.5 22h7"/><rect x="3.5" y="8.5" width="13" height="9" rx="2" transform="rotate(-45 10 13)"/>
              </svg>
              <span className="lbl">Gumka</span>
            </button>
          </div>

          <div className="divider" />

          <div className="swatches">
            {PEN_COLORS.map(c => (
              <button key={c} className={`swatch ${penColor === c && tool === 'pen' ? 'is-active' : ''}`}
                style={{ background: c, color: c }} onClick={() => { setPenColor(c); setTool('pen') }} />
            ))}
          </div>

          <div className="sizes">
            {(['small', 'medium', 'large'] as const).map(s => (
              <button key={s} className={`size-dot ${penSize === s && tool === 'pen' ? 'is-active' : ''}`}
                onClick={() => { setPenSize(s); setTool('pen') }}>
                <i style={{ width: SIZE_DOTS[s], height: SIZE_DOTS[s] }} />
              </button>
            ))}
          </div>

          <div className="divider" />

          <div className="tool-group">
            <button className="tbtn ghost" onClick={() => canvasRef.current?.undo()} disabled={!canUndo} title="Cofnij (Ctrl+Z)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="19" height="19">
                <path d="M3 7v6h6"/><path d="M3.5 13a9 9 0 1 1 2 6.4"/>
              </svg>
              <span className="lbl">Cofnij</span>
            </button>
            <button className="tbtn ghost" onClick={() => { canvasRef.current?.clear(true); setHasDrawn(false) }} title="Wyczyść tablicę">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="19" height="19">
                <path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              </svg>
              <span className="lbl">Wyczyść</span>
            </button>
          </div>
        </div>
      </header>

      <main className="main">
        <section className="board-wrap">
          <div className="board">
            <DrawingCanvas
              ref={canvasRef}
              tool={tool}
              penColor={penColor}
              penSize={penSize}
              onFirstDraw={() => setHasDrawn(true)}
              onUndoStackChange={setCanUndo}
            />
            {!hasDrawn && (
              <div className="placeholder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="30" height="30">
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
                </svg>
                Pisz tutaj swoją odpowiedź
              </div>
            )}
          </div>
        </section>

        <ExercisePanel
          exercise={exercise}
          solvedCount={solvedCount}
          onCheck={handleCheck}
          onSelfAssess={handleSelfAssess}
          onNext={handleNext}
          onSkip={handleNext}
          onTeach={handleTeach}
        />
      </main>
    </div>
  )
}
