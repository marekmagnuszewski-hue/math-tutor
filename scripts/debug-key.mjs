import { fileURLToPath } from 'url'
import { dirname } from 'path'

const canvasMod = await import('@napi-rs/canvas')
if (typeof globalThis.DOMMatrix === 'undefined') globalThis.DOMMatrix = canvasMod.DOMMatrix
if (typeof globalThis.ImageData === 'undefined') globalThis.ImageData = canvasMod.ImageData

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const workerUrl = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.href

const res = await fetch('https://arkusze.pl/maturalne/matematyka-2025-maj-matura-rozszerzona-odpowiedzi.pdf', { headers: { 'User-Agent': 'Mozilla/5.0' } })
const buf = Buffer.from(await res.arrayBuffer())
const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
console.log('Key PDF pages:', doc.numPages)
for (let i = 1; i <= Math.min(3, doc.numPages); i++) {
  const page = await doc.getPage(i)
  const content = await page.getTextContent()
  console.log(`\n=== PAGE ${i} ===`)
  console.log(content.items.map(x => x.str).join(' ').slice(0, 1000))
}
