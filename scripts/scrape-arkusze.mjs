#!/usr/bin/env node
/**
 * scripts/scrape-arkusze.mjs
 *
 * Scrapes matura rozszerzona exam exercises from arkusze.pl.
 * Uses PDF text positions to detect "Zadanie N" headers and crop each task
 * into its own image — no vision AI needed per page.
 *
 * Usage:
 *   node --env-file=.env scripts/scrape-arkusze.mjs
 *
 * Output:
 *   public/exercises/highschool/*-t{N}.jpg  — per-task cropped images
 *   public/exercises/highschool/*-p{N}.jpg  — full page images (for hints)
 *   src/data/highschool-exercises.json      — exercise manifest
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT     = join(__dirname, '..')
const OUT_DIR  = join(ROOT, 'public', 'exercises', 'highschool')
const MANIFEST = join(ROOT, 'src', 'data', 'highschool-exercises.json')
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const TEXT     = 'llama-3.3-70b-versatile'

mkdirSync(OUT_DIR, { recursive: true })
mkdirSync(join(ROOT, 'src', 'data'), { recursive: true })

const EXAMS = [
  { url: 'https://arkusze.pl/matura-matematyka-2026-maj-poziom-rozszerzony/', label: 'CKE maj 2026' },
  { url: 'https://arkusze.pl/matura-matematyka-2025-maj-poziom-rozszerzony/', label: 'CKE maj 2025' },
  { url: 'https://arkusze.pl/matura-matematyka-2024-maj-poziom-rozszerzony/', label: 'CKE maj 2024' },
  { url: 'https://arkusze.pl/matura-matematyka-2023-maj-poziom-rozszerzony/', label: 'CKE maj 2023' },
  { url: 'https://arkusze.pl/matura-matematyka-2022-maj-poziom-rozszerzony/', label: 'CKE maj 2022' },
  { url: 'https://arkusze.pl/matura-matematyka-2021-maj-poziom-rozszerzony/', label: 'CKE maj 2021' },
  { url: 'https://arkusze.pl/matura-matematyka-2019-maj-poziom-rozszerzony/', label: 'CKE maj 2019' },
  { url: 'https://arkusze.pl/matura-matematyka-2018-maj-poziom-rozszerzony/', label: 'CKE maj 2018' },
]

// ── Utilities ─────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (educational use)' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

async function fetchBuf(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (educational use)' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

async function callGroq(messages, model = TEXT, maxTokens = 512, retries = 12) {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY not set in .env')
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
    })
    const data = await res.json()
    if (data.error) {
      const msg = data.error.message ?? ''
      const minsMatch = msg.match(/try again in (\d+)m([\d.]+)s/i)
      const secsMatch = !minsMatch && msg.match(/try again in ([\d.]+)s/i)
      let waitMs = 8000
      if (minsMatch) waitMs = (parseInt(minsMatch[1]) * 60 + parseFloat(minsMatch[2])) * 1000 + 1000
      else if (secsMatch) waitMs = Math.ceil(parseFloat(secsMatch[1]) * 1000) + 500
      if (waitMs > 2 * 60 * 60 * 1000) {
        console.error(`\n  Rate limit wait too long (${(waitMs/60000).toFixed(1)} min). Run again later.`)
        process.exit(0)
      }
      if ((res.status === 429 || msg.includes('Rate limit')) && attempt < retries) {
        console.log(`    Rate limit — waiting ${(waitMs/1000).toFixed(1)}s...`)
        await sleep(waitMs)
        continue
      }
      throw new Error(msg)
    }
    return data.choices?.[0]?.message?.content ?? ''
  }
  throw new Error('Max retries exceeded')
}

// ── PDF setup ─────────────────────────────────────────────────────────────────

let _pdfjs = null
let _createCanvas = null

async function loadDeps() {
  if (_pdfjs) return
  try {
    const canvasMod = await import('@napi-rs/canvas')
    _createCanvas = canvasMod.createCanvas
    if (typeof globalThis.DOMMatrix === 'undefined') globalThis.DOMMatrix = canvasMod.DOMMatrix
    if (typeof globalThis.ImageData  === 'undefined') globalThis.ImageData  = canvasMod.ImageData
    if (typeof globalThis.Image      === 'undefined') globalThis.Image      = canvasMod.Image
    _pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const workerUrl = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)
    _pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.href
    console.log('  PDF deps loaded OK')
  } catch (err) {
    console.error('Cannot load PDF deps:', err.message)
    process.exit(1)
  }
}

class CanvasFactory {
  create(w, h) { const c = _createCanvas(w, h); return { canvas: c, context: c.getContext('2d') } }
  reset(cc, w, h) { cc.canvas.width = w; cc.canvas.height = h }
  destroy() {}
}

async function openPdf(buf) {
  return _pdfjs.getDocument({ data: new Uint8Array(buf), canvasFactory: new CanvasFactory() }).promise
}

// ── Task boundary detection ───────────────────────────────────────────────────
// Scans PDF text items for "Zadanie N" headers and returns their canvas y-positions.

async function findTaskBoundaries(doc, pageNum, scale) {
  const page = await doc.getPage(pageNum)
  const vp1  = page.getViewport({ scale: 1 })
  const pageHeight = vp1.height  // PDF user-space height (y measured from bottom)
  const content = await page.getTextContent()
  const items = content.items

  const headers = []

  for (let i = 0; i < items.length; i++) {
    const str = items[i].str.trim()

    // Case 1: "Zadanie 5" or "Zadanie 5." all in one item
    const directMatch = str.match(/^Zadanie\s+(\d+)\b/i)
    if (directMatch) {
      const pdfY    = items[i].transform[5]
      const canvasY = Math.round((pageHeight - pdfY) * scale)
      headers.push({ nr: directMatch[1], canvasY })
      continue
    }

    // Case 2: "Zadanie" alone, number in a following item
    if (/^Zadanie$/i.test(str)) {
      for (let j = i + 1; j < Math.min(i + 6, items.length); j++) {
        const next = items[j].str.trim()
        if (!next) continue
        const numMatch = next.match(/^(\d+)/)
        if (numMatch) {
          const pdfY    = items[i].transform[5]
          const canvasY = Math.round((pageHeight - pdfY) * scale)
          headers.push({ nr: numMatch[1], canvasY })
          break
        }
        if (next.length > 3) break  // non-number text → stop looking
      }
    }
  }

  // Sort top-to-bottom, deduplicate (keep topmost occurrence of each task nr)
  const seen = new Set()
  return headers
    .sort((a, b) => a.canvasY - b.canvasY)
    .filter(h => { if (seen.has(h.nr)) return false; seen.add(h.nr); return true })
}

// ── Page render + crop ────────────────────────────────────────────────────────

const SCALE = 1.8

async function renderPageAndCrop(doc, pageNum) {
  const headers = await findTaskBoundaries(doc, pageNum, SCALE)

  const page = await doc.getPage(pageNum)
  const vp   = page.getViewport({ scale: SCALE })
  const canvas = _createCanvas(Math.round(vp.width), Math.round(vp.height))
  // White background (PDF is transparent by default)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport: vp }).promise
  const fullJpeg = canvas.toBuffer('image/jpeg', { quality: 0.88 })

  if (headers.length === 0) return { fullJpeg, crops: [] }

  const crops = []
  for (let i = 0; i < headers.length; i++) {
    const { nr, canvasY } = headers[i]
    // Start 32px above the header baseline so the header text is fully included
    const yStart = Math.max(0, canvasY - 32)
    // End just before the next task header, or at page bottom
    const yEnd = i + 1 < headers.length
      ? headers[i + 1].canvasY - 16
      : canvas.height
    const height = yEnd - yStart
    if (height < 80) continue

    const cropCanvas = _createCanvas(canvas.width, height)
    const cropCtx    = cropCanvas.getContext('2d')
    cropCtx.drawImage(canvas, 0, yStart, canvas.width, height, 0, 0, canvas.width, height)
    crops.push({ nr, jpeg: cropCanvas.toBuffer('image/jpeg', { quality: 0.88 }) })
  }

  return { fullJpeg, crops }
}

// ── Answer extraction (AI, once per exam) ─────────────────────────────────────

async function extractAnswerMap(keyText) {
  const answers = {}
  const chunkSize = 5000
  const overlap  = 500
  for (let offset = 0; offset < keyText.length; offset += chunkSize - overlap) {
    const chunk = keyText.slice(offset, offset + chunkSize)
    if (chunk.trim().length < 50) continue
    try {
      const result = await callGroq([{
        role: 'user',
        content: `From this excerpt of a Polish matura math answer key, extract the correct final answer for each task.

KEY EXCERPT:
${chunk}

Output one line per task found: ANSWER [N]: [final correct answer]
- For multiple choice: letter only (A/B/C/D)
- For calculations: the final numeric or algebraic result
- For proofs: write "dowód" (no numeric answer)
Only output tasks with a clear correct answer. Skip tasks not visible in this excerpt.`,
      }], TEXT, 400)
      for (const line of result.split('\n')) {
        const m = line.match(/ANSWER\s+(\d+[a-z]?):\s*(.+)/i)
        if (m && !answers[m[1]]) answers[m[1]] = m[2].trim()
      }
    } catch { /* skip failed chunks */ }
    await sleep(500)
  }
  return answers
}

async function extractFullText(buf) {
  const doc = await _pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
  let text = ''
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    text += content.items.map(item => item.str).join(' ') + '\n'
  }
  return text
}

// ── Per-exam processing ───────────────────────────────────────────────────────

async function extractPdfLinks(pageUrl) {
  const html = await fetchText(pageUrl)
  const matches = [...html.matchAll(/href="(https?:\/\/arkusze\.pl\/maturalne\/[^"]+\.pdf)"/g)]
  return matches.map(m => m[1])
}

async function processExam(exam, manifest) {
  const { url, label } = exam
  console.log(`\n--- ${label}`)

  let links
  try { links = await extractPdfLinks(url) }
  catch (err) { console.log(`  SKIP: page fetch failed — ${err.message}`); return }

  if (links.length < 2) {
    console.log(`  SKIP: PDFs not available (${links.length} links found)`)
    return
  }

  const [examUrl, keyUrl] = links
  const slug = examUrl.split('/').pop().replace('.pdf', '')

  const done = manifest.filter(e => e.id.startsWith(slug + '-') && e.taskImage).length
  if (done > 0) {
    console.log(`  SKIP: already in manifest (${done} tasks)`)
    return
  }

  let examBuf, keyBuf
  try {
    console.log(`  Downloading...`)
    ;[examBuf, keyBuf] = await Promise.all([fetchBuf(examUrl), fetchBuf(keyUrl)])
  } catch (err) {
    console.log(`  SKIP: download failed — ${err.message}`)
    return
  }

  // Extract answers from key PDF (text model, once per exam)
  let answerMap = {}
  try {
    const keyText = await extractFullText(keyBuf)
    console.log(`  Extracting answer map from key (${Math.ceil(keyText.length/5000)} chunks)...`)
    answerMap = await extractAnswerMap(keyText)
    console.log(`  Answer map: ${Object.keys(answerMap).length} tasks — ${JSON.stringify(answerMap).slice(0, 140)}`)
  } catch (err) {
    console.warn(`  Key extraction failed: ${err.message}`)
  }

  // Open exam PDF
  let examDoc, numPages
  try {
    examDoc = await openPdf(examBuf)
    numPages = examDoc.numPages
  } catch (err) {
    console.log(`  SKIP: PDF parse failed — ${err.message}`)
    return
  }

  console.log(`  ${numPages} pages`)

  for (let p = 1; p <= numPages; p++) {
    const pageSlug    = `${slug}-p${p}`
    const pageFile    = `${pageSlug}.jpg`
    const pageFilepath = join(OUT_DIR, pageFile)

    let fullJpeg, crops
    try {
      ;({ fullJpeg, crops } = await renderPageAndCrop(examDoc, p))
    } catch (err) {
      console.warn(`  Page ${p}: render failed — ${err.message}`)
      continue
    }

    // Always save/overwrite full page image (used by hints endpoint)
    writeFileSync(pageFilepath, fullJpeg)

    if (crops.length === 0) {
      console.log(`  Page ${p}: no "Zadanie N" headers detected — skipped`)
      continue
    }

    let added = 0
    for (const { nr, jpeg } of crops) {
      const answer = answerMap[nr]
      if (!answer) {
        console.log(`    Task ${nr}: no answer in key — skip`)
        continue
      }

      const taskFile    = `${pageSlug}-t${nr}.jpg`
      const taskFilepath = join(OUT_DIR, taskFile)
      writeFileSync(taskFilepath, jpeg)

      // Use slug+taskNr as ID (not page) — task starts on this page
      const id = `${slug}-t${nr}`
      if (manifest.some(e => e.id === id)) {
        console.log(`    Task ${nr}: already in manifest — skip`)
        continue
      }

      manifest.push({
        id,
        source: label,
        taskImage: `/exercises/highschool/${taskFile}`,
        pageImage: `/exercises/highschool/${pageFile}`,
        taskNr: parseInt(nr),
        answer,
        topic: `Matura rozszerzona · ${label}`,
        points: 1,
      })
      added++
    }

    const nrs = crops.map(c => c.nr).join(', ')
    console.log(`  Page ${p}: tasks [${nrs}] → ${added} added`)
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2))
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  console.log('Scraping arkusze.pl — matura matematyka rozszerzona (crop mode)')
  console.log(`Images   → ${OUT_DIR}`)
  console.log(`Manifest → ${MANIFEST}`)

  await loadDeps()

  let manifest = []
  if (existsSync(MANIFEST)) {
    try { manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) }
    catch { manifest = [] }
  }

  // Auto-migrate: clear old-format manifest (entries had taskText instead of taskImage)
  if (manifest.length > 0 && manifest[0].taskText !== undefined) {
    console.log('Old manifest format detected — clearing for fresh scrape...')
    manifest = []
    writeFileSync(MANIFEST, '[]')
  } else if (manifest.length > 0) {
    console.log(`Resuming: ${manifest.length} tasks already saved`)
  }

  for (const exam of EXAMS) {
    await processExam(exam, manifest)
    await sleep(2000)
  }

  console.log(`\nDone — ${manifest.length} exercises in manifest`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
