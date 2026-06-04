import { useState, useCallback } from 'react'
import { buildHintsText } from '../lib/trainingData'
import { apiUrl } from '../lib/api'

interface RecognitionResult {
  latex: string
  confidence?: number
}

interface StoredCorrection {
  imageData: string
  original: string
  corrected: string
  timestamp: number
}

const CORRECTIONS_KEY = 'math-tutor-corrections'

function saveCorrection(correction: StoredCorrection) {
  const existing: StoredCorrection[] = JSON.parse(localStorage.getItem(CORRECTIONS_KEY) || '[]')
  existing.push(correction)
  localStorage.setItem(CORRECTIONS_KEY, JSON.stringify(existing.slice(-200))) // keep last 200
}

export function useMathRecognition() {
  const [result, setResult] = useState<RecognitionResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recognize = useCallback(async (imageBase64: string) => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch(apiUrl('/api/recognize'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageBase64, hints: buildHintsText() }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Server error ${res.status}`)
      }

      const data = await res.json()
      setResult({ latex: data.latex })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recognition failed')
    } finally {
      setLoading(false)
    }
  }, [])

  const submitCorrection = useCallback((imageBase64: string, original: string, corrected: string) => {
    saveCorrection({ imageData: imageBase64, original, corrected, timestamp: Date.now() })
    setResult({ latex: corrected })
  }, [])

  const reset = useCallback(() => {
    setResult(null)
    setError(null)
  }, [])

  return { result, loading, error, recognize, submitCorrection, reset }
}
