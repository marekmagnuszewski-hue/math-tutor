const key = (mode: 'moderate' | 'highschool') => `math-tutor-pool-${mode}`

export interface CustomExercise {
  id: string
  image?: string      // base64 data URL (user-uploaded)
  taskImage?: string  // server path to cropped task image (CKE builtin)
  pageImage?: string  // server path to full page image (used for hints)
  text?: string       // LaTeX problem text (CKE text-based exercises)
  answer: string
  topic: string
  createdAt: number
}

export function getExercises(mode: 'moderate' | 'highschool'): CustomExercise[] {
  try { return JSON.parse(localStorage.getItem(key(mode)) || '[]') }
  catch { return [] }
}

export function addExercise(mode: 'moderate' | 'highschool', ex: Omit<CustomExercise, 'id' | 'createdAt'>): void {
  const list = getExercises(mode)
  list.push({ ...ex, id: crypto.randomUUID(), createdAt: Date.now() })
  localStorage.setItem(key(mode), JSON.stringify(list))
}

export function removeExercise(mode: 'moderate' | 'highschool', id: string): void {
  const list = getExercises(mode).filter(e => e.id !== id)
  localStorage.setItem(key(mode), JSON.stringify(list))
}

export function pickRandom(mode: 'moderate' | 'highschool', lastId?: string): CustomExercise | null {
  const list = getExercises(mode)
  if (list.length === 0) return null
  if (list.length === 1) return list[0]
  const pool = list.filter(e => e.id !== lastId)
  return pool[Math.floor(Math.random() * pool.length)]
}
