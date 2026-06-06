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
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

function getApiKey() {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY not configured in .env')
  return key
}

// Parse a data URL into { mediaType, data } for Anthropic image blocks
function parseDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/)
  if (!match) throw new Error('Invalid image data URL')
  return { mediaType: match[1], data: match[2] }
}

async function callClaude(messages, model = 'claude-sonnet-4-6', maxTokens = 512) {
  const response = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': getApiKey(),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
  })
  const data = await response.json()
  if (data.error) throw new Error(data.error.message || 'Anthropic API error')
  return data.content?.[0]?.text ?? ''
}

function extractNumber(text) {
  const t = text.trim()
  if (/^\d+$/.test(t)) return t
  const matches = t.match(/\b\d+\b/g)
  if (matches) return matches[matches.length - 1]
  const norm = t.replace(/[lI|]/g, '1').replace(/[Oo]/g, '0')
  if (/^\d+$/.test(norm)) return norm
  const normMatches = norm.match(/\d+/g)
  if (normMatches) return normMatches[normMatches.length - 1]
  return t
}

// ── POST /api/recognize ───────────────────────────────────────────────────────
app.post('/api/recognize', async (req, res) => {
  const { image, hints, mode, taskText } = req.body
  if (!image) return res.status(400).json({ error: 'No image provided' })

  const correctionBlock = hints ? `Digit corrections for this user:\n${hints}\n\n` : ''
  const contextBlock = taskText ? `The math problem is: ${taskText}\n` : ''
  const promptText = mode === 'number'
    ? `${correctionBlock}${contextBlock}What integer is written in this image? It is between 0 and 81.
Reply with the digits ONLY — no words, no spaces, no punctuation.
If you see a stroke that looks like l or I, it is the digit 1.
Notes: 7 with a crossbar = 7. Open oval = 0. 6 with long tail = 6.`
    : `${correctionBlock}${contextBlock}Handwritten math expression in the image. Return ONLY the LaTeX, nothing else.`

  try {
    const { mediaType, data } = parseDataUrl(image)
    const result = await callClaude([{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
        { type: 'text', text: promptText },
      ],
    }])

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

  const strip = (s) => s
    .replace(/\s+/g, '')
    .replace(/^\$\$?/, '').replace(/\$\$?$/, '')
    .replace(/\\[a-zA-Z]+\{?/g, '').replace(/\}/g, '')
    .toLowerCase()

  const strUser = strip(userAnswer)
  const strCorrect = strip(correctAnswer)

  if (strUser && strCorrect && strUser === strCorrect) {
    console.log(`Check (strip match): "${userAnswer}" ✓`)
    return res.json({ equivalent: true })
  }

  const toInt = (s) => parseInt(s.replace(/[^0-9-]/g, ''), 10)
  const intUser = toInt(strUser)
  const intCorrect = toInt(strCorrect)
  if (!isNaN(intUser) && !isNaN(intCorrect) && intUser === intCorrect) {
    console.log(`Check (int match): ${intUser} ✓`)
    return res.json({ equivalent: true })
  }

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

    const text = await callClaude([{ role: 'user', content: prompt }])
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
    const { mediaType, data } = parseDataUrl(imageUrl)
    const result = await callClaude([{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
        { type: 'text', text: prompt },
      ],
    }], 'claude-sonnet-4-6', 1024)

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
