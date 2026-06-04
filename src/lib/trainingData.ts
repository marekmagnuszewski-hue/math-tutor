const KEY = 'math-tutor-training'

export interface TrainingEntry {
  target: string
  recognized: string
  confirmed: string
  round?: number
}

export function getTrainingData(): TrainingEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    return []
  }
}

export function saveTrainingEntry(entry: TrainingEntry) {
  const existing = getTrainingData()
  // If round is supplied, dedupe on target+round so all 3 rounds are kept separately.
  // Without round, dedupe on target alone (legacy / manual correction flow).
  const same = (e: TrainingEntry) =>
    entry.round !== undefined
      ? e.target === entry.target && e.round === entry.round
      : e.target === entry.target && e.round === undefined
  const idx = existing.findIndex(same)
  if (idx >= 0) existing[idx] = entry
  else existing.push(entry)
  localStorage.setItem(KEY, JSON.stringify(existing))
}

export function isTrainingComplete(): boolean {
  const data = getTrainingData()
  return data.length >= TRAINING_STEPS.length
}

export function clearTrainingData(): void {
  localStorage.removeItem(KEY)
}

export function buildHintsText(): string {
  const data = getTrainingData()

  // Teach-it entries (no round) are user-confirmed — always trusted.
  // Calibration entries (with round) must appear in 2+ rounds to avoid
  // a single bad OCR read poisoning the correction table.
  const manuals = new Map<string, { recognized: string; confirmed: string }>()
  const calibCounts = new Map<string, { recognized: string; confirmed: string; count: number }>()

  for (const e of data) {
    if (!e.recognized || e.recognized === e.confirmed) continue
    const key = `${e.recognized}|||${e.confirmed}`
    if (e.round === undefined) {
      if (!manuals.has(key)) manuals.set(key, { recognized: e.recognized, confirmed: e.confirmed })
    } else {
      const existing = calibCounts.get(key)
      if (existing) existing.count++
      else calibCounts.set(key, { recognized: e.recognized, confirmed: e.confirmed, count: 1 })
    }
  }

  const seen = new Set<string>()
  const lines: string[] = []

  for (const { recognized, confirmed } of manuals.values()) {
    const key = `${recognized}|||${confirmed}`
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(`  - If you see "${recognized}", the correct digit is "${confirmed}"`)
  }

  for (const { recognized, confirmed, count } of calibCounts.values()) {
    if (count < 2) continue
    const key = `${recognized}|||${confirmed}`
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(`  - If you see "${recognized}", the correct digit is "${confirmed}"`)
  }

  if (lines.length === 0) return ''
  return `This user writes certain digits in a non-standard style. Correction table:\n${lines.join('\n')}\nApply every correction above.`
}

export const TRAINING_STEPS: Array<{ display: string; target: string; instruction: string }> = [
  { display: '1', target: '1', instruction: 'Write the number 1' },
  { display: '2', target: '2', instruction: 'Write the number 2' },
  { display: '3', target: '3', instruction: 'Write the number 3' },
  { display: '4', target: '4', instruction: 'Write the number 4' },
  { display: '5', target: '5', instruction: 'Write the number 5' },
  { display: '6', target: '6', instruction: 'Write the number 6' },
  { display: '7', target: '7', instruction: 'Write the number 7' },
  { display: '8', target: '8', instruction: 'Write the number 8' },
  { display: '9', target: '9', instruction: 'Write the number 9' },
  { display: '0', target: '0', instruction: 'Write the number 0' },
  { display: '+', target: '+', instruction: 'Write the plus sign' },
  { display: '−', target: '-', instruction: 'Write the minus sign' },
  { display: '×', target: '\\times', instruction: 'Write the multiplication sign' },
  { display: '=', target: '=', instruction: 'Write the equals sign' },
  { display: '2 + 3', target: '2+3', instruction: 'Write the expression  2 + 3' },
  { display: '4 × 5', target: '4 \\times 5', instruction: 'Write the expression  4 × 5' },
  { display: '7 − 2', target: '7-2', instruction: 'Write the expression  7 − 2' },
]
