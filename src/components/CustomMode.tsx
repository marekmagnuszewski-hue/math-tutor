import { useRef, useState, useCallback, useMemo } from 'react'
import katex from 'katex'
import DrawingCanvas, { type CanvasHandle } from './DrawingCanvas'
import ExercisePanel from './ExercisePanel'
import { buildHintsText } from '../lib/trainingData'
import { getExercises, addExercise, removeExercise, type CustomExercise } from '../lib/customExercises'
import { getBuiltinExercises, getBuiltinCount, getBuiltinGroups } from '../lib/builtinExercises'
import type { Exercise } from '../lib/exerciseGenerator'

function renderMixed(text: string): string {
  return text.split(/(\$[^$]+\$)/).map(part => {
    if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
      try { return katex.renderToString(part.slice(1, -1), { throwOnError: false }) }
      catch { return part }
    }
    return part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }).join('')
}

const PEN_COLORS = ['#2E2820', '#FF6A2C', '#2C7BE5', '#2FA876']
const SIZE_DOTS = { small: 6, medium: 10, large: 15 }

const MODE_LABEL: Record<'moderate' | 'highschool', string> = {
  moderate: 'Średniozaawansowany · Klasy 4–8',
  highschool: 'Liceum · Klasy 1–4 LO',
}

interface Props {
  mode: 'moderate' | 'highschool'
  onHome: () => void
}

export default function CustomMode({ mode, onHome }: Props) {
  const [view, setView] = useState<'manage' | 'practice'>('manage')

  if (view === 'manage') {
    return <ManagerView mode={mode} onHome={onHome} onPractice={() => setView('practice')} />
  }
  return <PracticeView mode={mode} onHome={onHome} onBack={() => setView('manage')} />
}

// ── Exercise manager ──────────────────────────────────────────────────────────

function ManagerView({
  mode, onHome, onPractice,
}: { mode: 'moderate' | 'highschool'; onHome: () => void; onPractice: () => void }) {
  const [exercises, setExercises] = useState(() => getExercises(mode))
  const builtinCount = mode === 'highschool' ? getBuiltinCount() : 0
  const totalCount = exercises.length + builtinCount
  const [previewImg, setPreviewImg] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [topic, setTopic] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const reload = () => setExercises(getExercises(mode))

  const loadFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = e => setPreviewImg(e.target?.result as string)
    reader.readAsDataURL(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('image/')) loadFile(file)
  }

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'))
    if (item) loadFile(item.getAsFile()!)
  }, [])

  const handleSave = () => {
    if (!previewImg || !answer.trim()) return
    addExercise(mode, {
      image: previewImg,
      answer: answer.trim(),
      topic: topic.trim() || 'General',
    })
    reload()
    setPreviewImg(null)
    setAnswer('')
    setTopic('')
  }

  const handleDelete = (id: string) => {
    removeExercise(mode, id)
    reload()
  }

  return (
    <div className="app" tabIndex={-1} onPaste={handlePaste}>
      <div className="bg-blob a" /><div className="bg-blob b" />

      <header className="topbar">
        <button className="brand brand-btn" onClick={onHome}>
          <span className="name">Math<b>Tutor</b></span>
        </button>
        <div className="mode-badge">{MODE_LABEL[mode]}</div>
        {totalCount > 0 && (
          <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={onPractice}>
            Ćwicz ({totalCount}) →
          </button>
        )}
      </header>

      <main className="manager-main">
        {/* Upload area */}
        <section className="upload-section">
          <h2 className="section-title">Dodaj zadanie</h2>
          <div
            ref={dropRef}
            className={`drop-zone ${previewImg ? 'has-image' : ''}`}
            onClick={() => !previewImg && fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
          >
            {previewImg ? (
              <>
                <img src={previewImg} className="drop-preview" alt="preview" />
                <button className="drop-clear" onClick={e => { e.stopPropagation(); setPreviewImg(null) }}>✕</button>
              </>
            ) : (
              <div className="drop-placeholder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="32" height="32">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                <span>Kliknij, upuść lub wklej obraz</span>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = '' }} />

          <div className="upload-fields">
            <input
              className="field-input"
              placeholder="Prawidłowa odpowiedź (np. 42, x=3, ½)"
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
            <input
              className="field-input"
              placeholder="Temat (opcjonalnie)"
              value={topic}
              onChange={e => setTopic(e.target.value)}
            />
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={!previewImg || !answer.trim()}
            >
              Dodaj do zestawu
            </button>
          </div>
        </section>

        {/* CKE matura tabs */}
        {mode === 'highschool' && <MaturaSection />}

        {/* Pool */}
        {exercises.length > 0 && (
          <section className="pool-section">
            <h2 className="section-title">Twoje zadania ({exercises.length})</h2>
            <div className="pool-grid">
              {exercises.map(ex => (
                <ExerciseCard key={ex.id} ex={ex} onDelete={() => handleDelete(ex.id)} />
              ))}
            </div>
          </section>
        )}

        {exercises.length === 0 && builtinCount === 0 && (
          <p className="pool-empty">Brak zadań — dodaj je powyżej, aby rozpocząć ćwiczenia.</p>
        )}
      </main>
    </div>
  )
}

function MaturaSection() {
  const groups = useMemo(() => getBuiltinGroups(), [])
  const [activeSource, setActiveSource] = useState(() => groups[0]?.source ?? '')

  if (groups.length === 0) return null
  const active = groups.find(g => g.source === activeSource)

  return (
    <section>
      <h2 className="section-title">Arkusze CKE — Matura rozszerzona</h2>
      <div className="matura-tabs">
        {groups.map(g => (
          <button
            key={g.source}
            className={`matura-tab${g.source === activeSource ? ' is-active' : ''}`}
            onClick={() => setActiveSource(g.source)}
          >
            {g.label}
            <span className="matura-tab-count">{g.exercises.length}</span>
          </button>
        ))}
      </div>
      <div className="matura-list">
        {active?.exercises.map(ex => (
          <div key={ex.id} className="matura-item">
            <div className="matura-item-head">
              <span className="matura-item-nr">Zadanie {ex.taskNr}</span>
              <span className="matura-item-pts">{ex.points} pkt</span>
            </div>
            {ex.text && (
              <div
                className="matura-item-text"
                dangerouslySetInnerHTML={{ __html: renderMixed(ex.text) }}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function ExerciseCard({ ex, onDelete }: { ex: CustomExercise; onDelete: () => void }) {
  return (
    <div className="pool-card">
      <img src={ex.image} className="pool-thumb" alt="" />
      <div className="pool-meta">
        <span className="pool-topic">{ex.topic}</span>
        <span className="pool-answer">= {ex.answer}</span>
      </div>
      <button className="pool-delete" onClick={onDelete} title="Remove">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  )
}

// ── Practice view ─────────────────────────────────────────────────────────────

function PracticeView({
  mode, onHome, onBack,
}: { mode: 'moderate' | 'highschool'; onHome: () => void; onBack: () => void }) {
  const canvasRef = useRef<CanvasHandle>(null)
  const [tool, setToolState] = useState<'pen' | 'erase'>('pen')
  const [penColor, setPenColor] = useState(PEN_COLORS[0])
  const [penSize, setPenSize] = useState<'small' | 'medium' | 'large'>('medium')
  const [canUndo, setCanUndo] = useState(false)
  const [hasDrawn, setHasDrawn] = useState(false)
  const pool = useMemo(() => {
    const user = getExercises(mode)
    const builtin = mode === 'highschool' ? getBuiltinExercises() : []
    return [...builtin, ...user]
  }, [mode])

  const [exercise, setExercise] = useState<Exercise | null>(() => buildExercise(pool, undefined))
  const [solvedCount, setSolvedCount] = useState(0)
  const lastId = useRef<string | undefined>(undefined)

  const setTool = useCallback((t: 'pen' | 'erase') => setToolState(t), [])

  const nextExercise = useCallback(() => {
    const ex = buildExercise(pool, lastId.current)
    if (!ex) return
    lastId.current = (ex as any).__id
    setExercise(ex)
    canvasRef.current?.clear(false)
    setHasDrawn(false)
  }, [pool])

  const handleCheck = useCallback(async (): Promise<{ correct: boolean | null; recognized: string | null }> => {
    if (!exercise) return { correct: null, recognized: null }
    const img = canvasRef.current?.getImageBase64()
    if (!img) return { correct: null, recognized: null }
    try {
      const isNumeric = /^\d+$/.test(exercise.answer.trim())
      const recRes = await fetch('/api/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: img, hints: buildHintsText(), mode: isNumeric ? 'number' : 'expression' }),
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

  const handleTeach = useCallback((_recognized: string, _confirmed: string) => {}, [])
  const handleSelfAssess = useCallback((correct: boolean) => { if (correct) setSolvedCount(c => c + 1) }, [])

  const handleRequestHints = useCallback(async (): Promise<string[]> => {
    if (!exercise) return []
    const imageForHints = (exercise as any).pageImage ?? exercise.questionImage
    if (!imageForHints) return [exercise.hint]
    try {
      const res = await fetch('/api/hints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: imageForHints,
          taskText: exercise.questionLatex,
          answer: exercise.answer,
          topic: exercise.topic,
        }),
      })
      if (!res.ok) return [exercise.hint]
      const data = await res.json()
      return Array.isArray(data.hints) && data.hints.length ? data.hints : [exercise.hint]
    } catch {
      return [exercise.hint]
    }
  }, [exercise])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    if (e.key.toLowerCase() === 'p') setTool('pen')
    if (e.key.toLowerCase() === 'e') setTool('erase')
  }, [setTool])

  if (!exercise) {
    return (
      <div className="app">
        <div className="bg-blob a" /><div className="bg-blob b" />
        <header className="topbar">
          <button className="brand brand-btn" onClick={onHome}><span className="name">Math<b>Tutor</b></span></button>
        </header>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
            <p>Brak zadań w zestawie.</p>
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={onBack}>← Powrót do zarządzania</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app" onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="bg-blob a" /><div className="bg-blob b" />

      <header className="topbar">
        <button className="brand brand-btn" onClick={onHome}><span className="name">Math<b>Tutor</b></span></button>

        <div className="toolbar">
          <button className="tbtn ghost" onClick={onBack} title="Powrót do zarządzania">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="19" height="19"><polyline points="15 18 9 12 15 6"/></svg>
            <span className="lbl">Zarządzaj</span>
          </button>

          <div className="divider" />

          <div className="tool-group">
            <button className={`tbtn ${tool === 'pen' ? 'is-active' : ''}`} onClick={() => setTool('pen')} title="Długopis (P)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="19" height="19"><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
              <span className="lbl">Pisz</span>
            </button>
            <button className={`tbtn ${tool === 'erase' ? 'is-active' : ''}`} onClick={() => setTool('erase')} title="Gumka (E)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="19" height="19"><path d="M4 16.5 9.5 22h7"/><rect x="3.5" y="8.5" width="13" height="9" rx="2" transform="rotate(-45 10 13)"/></svg>
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
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="19" height="19"><path d="M3 7v6h6"/><path d="M3.5 13a9 9 0 1 1 2 6.4"/></svg>
              <span className="lbl">Cofnij</span>
            </button>
            <button className="tbtn ghost" onClick={() => { canvasRef.current?.clear(true); setHasDrawn(false) }} title="Wyczyść tablicę">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="19" height="19"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
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
          onNext={nextExercise}
          onSkip={nextExercise}
          onTeach={handleTeach}
          onRequestHints={handleRequestHints}
        />
      </main>
    </div>
  )
}

function buildExercise(pool: CustomExercise[], lastId: string | undefined): (Exercise & { __id: string; pageImage?: string }) | null {
  if (pool.length === 0) return null
  const available = pool.length > 1 ? pool.filter(e => e.id !== lastId) : pool
  const raw = available[Math.floor(Math.random() * available.length)]
  const hasImage = !!(raw.taskImage ?? raw.image)
  return {
    __id: raw.id,
    topic: raw.topic,
    question: hasImage ? 'Rozwiąż zadanie pokazane poniżej.' : 'Rozwiąż zadanie:',
    questionLatex: raw.text ?? '',
    questionImage: raw.taskImage ?? raw.image,
    pageImage: raw.pageImage,
    hint: `Odpowiedź: ${raw.answer}`,
    answer: raw.answer,
  }
}
