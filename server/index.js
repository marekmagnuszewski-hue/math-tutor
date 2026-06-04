import express from 'express'
import cors from 'cors'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

const PORT = process.env.PORT ?? 3001
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

async function callGroq(messages, model = 'llama-3.3-70b-versatile', maxTokens = 512) {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error('GROQ_API_KEY not configured in .env')

  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
  })

  const data = await response.json()
  if (data.error) throw new Error(data.error.message || 'Groq API error')
  return data.choices?.[0]?.message?.content ?? ''
}

// Extract just the digit(s) from a possibly verbose model response
function extractNumber(text) {
  const t = text.trim()
  if (/^\d+$/.test(t)) return t                        // already clean: "7"

  // Try word-boundary match first (handles "The answer is 12")
  const matches = t.match(/\b\d+\b/g)
  if (matches) return matches[matches.length - 1]

  // Normalize common OCR letter↔digit confusions, then retry
  // l / I / | → 1    O / o → 0    (most frequent misreads for these digits)
  const norm = t
    .replace(/[lI|]/g, '1')
    .replace(/[Oo]/g, '0')
  if (/^\d+$/.test(norm)) return norm
  const normMatches = norm.match(/\d+/g)
  if (normMatches) return normMatches[normMatches.length - 1]

  return t
}

// ── POST /api/recognize ───────────────────────────────────────────────────────
app.post('/api/recognize', async (req, res) => {
  const { image, hints, mode } = req.body
  if (!image) return res.status(400).json({ error: 'No image provided' })

  // Keep corrections short so the model doesn't overthink
  const correctionBlock = hints ? `Digit corrections for this user:\n${hints}\n\n` : ''

  const promptText = mode === 'number'
    ? `${correctionBlock}What integer is written in this image? It is between 0 and 81.
Reply with the digits ONLY — no words, no spaces, no punctuation.
If you see a stroke that looks like l or I, it is the digit 1.
Notes: 7 with a crossbar = 7. Open oval = 0. 6 with long tail = 6.`
    : `${correctionBlock}Handwritten math expression in the image. Return ONLY the LaTeX, nothing else.`

  try {
    const result = await callGroq([
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: image } },
          { type: 'text', text: promptText },
        ],
      },
    ], 'meta-llama/llama-4-scout-17b-16e-instruct')

    // If model gave a verbose answer, extract the number from it
    const cleaned = mode === 'number'
      ? extractNumber(result)
      : result.trim()
          .replace(/^\$\$?/, '').replace(/\$\$?$/, '')
          .replace(/^\\[a-zA-Z]+\{/, '').replace(/\}$/, '')
          .trim()

    console.log(`Recognize [${mode ?? 'default'}]: "${cleaned}"`)
    res.json({ latex: cleaned })
  } catch (err) {
    console.error('Recognition error:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Recognition failed' })
  }
})

// ── POST /api/check ───────────────────────────────────────────────────────────
app.post('/api/check', async (req, res) => {
  const { userAnswer, correctAnswer } = req.body
  if (!userAnswer || !correctAnswer) return res.status(400).json({ error: 'Missing fields' })

  // Strip LaTeX/formatting and compare as plain text
  const strip = (s) => s
    .replace(/\s+/g, '')
    .replace(/^\$\$?/, '').replace(/\$\$?$/, '')
    .replace(/\\[a-zA-Z]+\{?/g, '').replace(/\}/g, '')
    .toLowerCase()

  const strUser = strip(userAnswer)
  const strCorrect = strip(correctAnswer)

  // Fast path: stripped text match
  if (strUser && strCorrect && strUser === strCorrect) {
    console.log(`Check (strip match): "${userAnswer}" ✓`)
    return res.json({ equivalent: true })
  }

  // Numeric fast path: both parse to the same integer
  const toInt = (s) => parseInt(s.replace(/[^0-9-]/g, ''), 10)
  const intUser = toInt(strUser)
  const intCorrect = toInt(strCorrect)
  if (!isNaN(intUser) && !isNaN(intCorrect) && intUser === intCorrect) {
    console.log(`Check (int match): ${intUser} ✓`)
    return res.json({ equivalent: true })
  }

  // AI fallback for non-trivial expressions (handles CKE-level high school math)
  try {
    const prompt = `You are a Polish high-school math grader (matura level). Decide if the student's answer is mathematically equivalent to the correct answer.

Correct answer: ${correctAnswer}
Student answer: ${userAnswer}

Rules:
- Equivalent forms count as correct: e.g. "1/2" = "0.5", "x=3" = "3", "-b/a" = "-(b/a)", "2√2" = "2\\sqrt{2}", "log₂8" = "3", "sin(30°)" = "1/2"
- Simplified and unsimplified forms are equal: "6/4" = "3/2", "x²-1" = "(x-1)(x+1)"
- For sets/intervals the notation may differ: "{1,3}" = "x∈{1,3}", "(-∞,2)" = "x<2"
- For inequalities: "x>0" = "0<x" = "(0,+∞)"
- For equations with multiple solutions, all solutions must match (order doesn't matter)
- Ignore trailing zeros, extra spaces, different fraction notation (a/b vs \\frac{a}{b})
- If the student wrote a decimal approximation within 0.01 of the exact value, count it correct
- Count as WRONG if: wrong number, extra or missing solutions, wrong sign, wrong variable

Reply with exactly one word: YES or NO.`

    const text = await callGroq([{ role: 'user', content: prompt }])

    console.log(`Check (AI): "${userAnswer}" vs "${correctAnswer}" → "${text.trim()}"`)
    res.json({ equivalent: /yes/i.test(text) })
  } catch (err) {
    console.error('Check error:', err)
    res.status(500).json({ error: 'Check failed' })
  }
})

// ── POST /api/hints ───────────────────────────────────────────────────────────
app.post('/api/hints', async (req, res) => {
  const { image, taskText, answer, topic } = req.body
  if (!image) return res.status(400).json({ error: 'No image provided' })

  // If image is a local path (/exercises/...), read it from disk as base64
  let imageUrl = image
  if (image.startsWith('/') && !image.startsWith('data:')) {
    const distPath = join(__dirname, '..', 'dist', image)
    const publicPath = join(__dirname, '..', 'public', image)
    const filePath = existsSync(distPath) ? distPath : existsSync(publicPath) ? publicPath : null
    if (!filePath) return res.status(404).json({ error: 'Image file not found' })
    try {
      const buf = readFileSync(filePath)
      imageUrl = `data:image/jpeg;base64,${buf.toString('base64')}`
    } catch {
      return res.status(404).json({ error: 'Image file not found' })
    }
  }

  const prompt = `Jesteś nauczycielem matematyki przygotowującym ucznia do matury rozszerzonej.

Na obrazku widoczne jest zadanie maturalne (CKE, poziom rozszerzony).
${topic ? `Dział: ${topic}\n` : ''}
Zadanie ma poprawną odpowiedź, którą znasz, ale NIE wolno Ci jej zdradzić w wskazówkach.

Twoje zadanie:
1. Przeczytaj zadanie z obrazka
2. Ustal liczbę kroków rozwiązania (= liczba punktów CKE; zwykle 2–5)
3. Napisz tyle wskazówek ile kroków — każda naprowadza na JEDEN krok, BEZ podawania wyniku

Zasady wskazówek:
- NIGDY nie podawaj końcowej odpowiedzi ani liczbowego wyniku
- Każda wskazówka = jeden krok rozwiązania, napisana jako polecenie/pytanie
- Styl: "Ułóż równanie...", "Zastosuj wzór...", "Wyznacz...", "Zbadaj znak...", "Co można wywnioskować z..."
- Jeśli zadanie jest dowodem — wskaż technikę dowodu i krok
- Po polsku, zwięźle (1–2 zdania)

Odpowiedz WYŁĄCZNIE w formacie JSON (bez żadnego innego tekstu):
{"points": <liczba całkowita>, "hints": ["wskazówka 1", "wskazówka 2", ...]}`

  try {
    const result = await callGroq([
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: prompt },
        ],
      },
    ], 'meta-llama/llama-4-scout-17b-16e-instruct', 1024)

    const jsonMatch = result.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON in response')
    const parsed = JSON.parse(jsonMatch[0])

    const hints = Array.isArray(parsed.hints) ? parsed.hints : []
    const points = parsed.points ?? hints.length ?? 1

    console.log(`Hints generated: ${points}p, ${hints.length} hints`)
    res.json({ points, hints })
  } catch (err) {
    console.error('Hints error:', err)
    res.status(500).json({ error: 'Failed to generate hints' })
  }
})

// Serve built frontend in production
const distDir = join(__dirname, '..', 'dist')
if (existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (_req, res) => res.sendFile(join(distDir, 'index.html')))
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
