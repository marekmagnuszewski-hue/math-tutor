import { useCallback, useEffect, useState } from 'react'
import katex from 'katex'
import type { Exercise } from '../lib/exerciseGenerator'

function renderMixedLatex(text: string): string {
  const parts = text.split(/(\$[^$]+\$)/)
  return parts.map(part => {
    if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
      const math = part.slice(1, -1)
      try { return katex.renderToString(math, { throwOnError: false }) }
      catch { return part }
    }
    return part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }).join('')
}

interface Props {
  exercise: Exercise | null
  solvedCount: number
  onCheck: () => Promise<{ correct: boolean | null; recognized: string | null }>
  onSelfAssess: (correct: boolean) => void
  onNext: () => void
  onSkip: () => void
  onTeach: (recognized: string, confirmed: string) => void
  onRequestHints?: () => Promise<string[]>
}

function confetti(evt: React.MouseEvent) {
  const x = evt.clientX, y = evt.clientY
  const wrap = document.createElement('div')
  wrap.style.cssText = `position:fixed;left:${x}px;top:${y}px;pointer-events:none;z-index:9999`
  const colors = ['#FF6A2C','#FFB23E','#2FA876','#2C7BE5']
  for (let i = 0; i < 18; i++) {
    const s = document.createElement('span')
    const ang = (Math.PI * 2 * i) / 18 + Math.random()
    const dist = 50 + Math.random() * 60
    const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist
    s.style.cssText = `position:absolute;width:9px;height:9px;border-radius:2px;background:${colors[i%colors.length]};animation:mathfly .7s ease-out forwards;--dx:${dx}px;--dy:${dy}px`
    wrap.appendChild(s)
  }
  if (!document.getElementById('mathfly-style')) {
    const st = document.createElement('style')
    st.id = 'mathfly-style'
    st.textContent = '@keyframes mathfly{from{transform:translate(0,0) scale(1);opacity:1}to{transform:translate(var(--dx),var(--dy)) scale(.2);opacity:0}}'
    document.head.appendChild(st)
  }
  document.body.appendChild(wrap)
  setTimeout(() => wrap.remove(), 800)
}

export default function ExercisePanel({
  exercise, solvedCount, onCheck, onSelfAssess, onNext, onSkip, onTeach, onRequestHints,
}: Props) {
  const [hintPhase, setHintPhase] = useState<'idle' | 'loading' | 'ready'>('idle')
  const [hints, setHints] = useState<string[]>([])
  const [hintIndex, setHintIndex] = useState(0)
  const [checking, setChecking] = useState(false)
  const [reveal, setReveal] = useState<{
    correct: boolean | null
    answer: string
    recognized: string | null
  } | null>(null)
  const [taught, setTaught] = useState(false)

  useEffect(() => {
    setReveal(null)
    setTaught(false)
    setHintPhase('idle')
    setHints([])
    setHintIndex(0)
  }, [exercise])

  const handleHint = useCallback(async () => {
    if (hintPhase === 'loading') return
    if (hintPhase === 'ready') {
      if (hintIndex < hints.length - 1) setHintIndex(i => i + 1)
      return
    }
    setHintPhase('loading')
    try {
      const loaded = onRequestHints ? await onRequestHints() : null
      setHints(loaded?.length ? loaded : [exercise?.hint ?? ''])
    } catch {
      setHints([exercise?.hint ?? ''])
    }
    setHintIndex(0)
    setHintPhase('ready')
  }, [hintPhase, hintIndex, hints.length, onRequestHints, exercise?.hint])

  const handleCheck = async (e: React.MouseEvent) => {
    if (checking || reveal) return
    setChecking(true)
    const { correct, recognized } = await onCheck()
    setReveal({ correct, answer: exercise?.answer ?? '', recognized })
    setChecking(false)
    if (correct === true) {
      confetti(e)
      onSelfAssess(true)
    }
    const eq = document.getElementById('eq-card')
    if (eq) { eq.classList.add('eq-pulse'); setTimeout(() => eq.classList.remove('eq-pulse'), 500) }
  }

  const handleTeach = () => {
    if (!reveal?.recognized || !exercise) return
    onTeach(reveal.recognized, exercise.answer)
    setTaught(true)
  }

  if (!exercise) return null

  return (
    <aside className="panel">
      {/* head */}
      <div className="panel-head">
        <span className="eyebrow">
          <span className="topic-pill">{exercise.topic}</span>
        </span>
        <span className="stars">
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
            <path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17.8 5.9 20.4l1.5-6.8L2.2 9l6.9-.7L12 2z"/>
          </svg>
          {solvedCount}
        </span>
      </div>

      {/* prompt */}
      <p className="prompt">{exercise.question}</p>

      {/* equation card */}
      <div className="eq-card" id="eq-card">
        {exercise.questionImage
          ? <img src={exercise.questionImage} className="eq-img" alt="" />
          : <div
              className={`eq-expr${exercise.questionLatex.replace(/\$[^$]+\$/g, '').trim().length > 10 ? ' eq-text' : ''}`}
              dangerouslySetInnerHTML={{ __html: renderMixedLatex(exercise.questionLatex) }}
            />
        }
      </div>

      <p className="instruct">Napisz odpowiedź na tablicy, a następnie kliknij <strong>Sprawdź</strong>.</p>

      {/* hint box */}
      {hintPhase === 'ready' && (
        <div className="hint-box show">
          {hints.length > 1 && (
            <span className="hint-counter">Wskazówka {hintIndex + 1} z {hints.length}</span>
          )}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="19" height="19">
            <path d="M9 18h6"/><path d="M10 22h4"/>
            <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/>
          </svg>
          <span>{hints[hintIndex]}</span>
        </div>
      )}

      {/* actions */}
      {!reveal && (
        <div className="actions">
          <button
            className="btn btn-ghost"
            onClick={handleHint}
            disabled={hintPhase === 'loading' || (hintPhase === 'ready' && hintIndex >= hints.length - 1)}
          >
            {hintPhase === 'loading'
              ? 'Ładuję…'
              : hintPhase === 'ready' && hintIndex < hints.length - 1
              ? `Wskazówka ${hintIndex + 2}/${hints.length}`
              : 'Podpowiedź'}
          </button>
          <button className="btn btn-primary" onClick={e => handleCheck(e)} disabled={checking}>
            {checking ? (
              <><span className="spinner-white" /> Sprawdzam…</>
            ) : (
              <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><polyline points="20 6 9 17 4 12"/></svg> Sprawdź</>
            )}
          </button>
          <button className="btn btn-soft" onClick={onSkip}>Pomiń</button>
        </div>
      )}

      {/* reveal */}
      {reveal && (
        <div className={`reveal show ${reveal.correct !== true ? 'miss' : ''}`}>
          <div className="ans-row">
            <span className="badge">
              {reveal.correct === true
                ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><polyline points="20 6 9 17 4 12"/></svg>
                : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              }
            </span>
            <span className="ans-txt">
              {reveal.correct === true
                ? <>Świetnie — to prawidłowa odpowiedź!</>
                : <>Niestety. Odpowiedź: <strong>{reveal.answer}</strong></>
              }
            </span>
          </div>

          {reveal.correct !== true && reveal.recognized && (
            <div className="teach-row">
              {!taught ? (
                <>
                  <span className="teach-label">System odczytał: <em>{reveal.recognized}</em></span>
                  <button className="teach-btn" onClick={handleTeach}>
                    Napisałem {reveal.answer} — naucz to
                  </button>
                </>
              ) : (
                <span className="teach-label teach-saved">✓ Zapisano — system zapamięta na przyszłość</span>
              )}
            </div>
          )}

          <div className="note">
            <span className="next-link" onClick={onNext}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
              </svg>
              Następne zadanie
            </span>
          </div>
        </div>
      )}
    </aside>
  )
}
