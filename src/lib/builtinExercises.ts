import rawData from '../data/highschool-exercises.json'
import type { CustomExercise } from './customExercises'

interface BuiltinEntry {
  id: string
  taskImage?: string   // crop-based scraper output
  taskText?: string    // text-based (Google Docs / old scraper)
  pageImage?: string
  taskNr: number | string
  answer: string
  topic: string
  source?: string
  points?: number
}

const BAD_ANSWER = /no answer|not (available|provided|found|listed)|cannot|unknown|unclear|brak opisu|NO TASKS/i

const entries = (rawData as BuiltinEntry[]).filter(
  e => e.answer && !BAD_ANSWER.test(e.answer) && (e.taskText || e.taskImage)
)

export function getBuiltinExercises(): CustomExercise[] {
  return entries.map(e => ({
    id: e.id,
    taskImage: e.taskImage,
    text: e.taskText,
    pageImage: e.pageImage,
    answer: e.answer,
    topic: e.topic,
    createdAt: 0,
  }))
}

export function getBuiltinCount(): number {
  return entries.length
}

export interface BuiltinExerciseItem {
  id: string
  taskNr: number | string
  points: number
  text?: string
  answer: string
  topic: string
}

export interface BuiltinSourceGroup {
  source: string
  label: string
  exercises: BuiltinExerciseItem[]
}

export function getBuiltinGroups(): BuiltinSourceGroup[] {
  const map = new Map<string, BuiltinSourceGroup>()
  for (const e of (rawData as BuiltinEntry[])) {
    if (!e.answer || BAD_ANSWER.test(e.answer) || (!e.taskText && !e.taskImage)) continue
    const source = e.source ?? 'Inne'
    if (!map.has(source)) {
      const yr = source.match(/\d{4}/)?.[0]
      map.set(source, { source, label: yr ? `Maj ${yr}` : source, exercises: [] })
    }
    map.get(source)!.exercises.push({
      id: e.id,
      taskNr: e.taskNr,
      points: e.points ?? 0,
      text: e.taskText,
      answer: e.answer,
      topic: e.topic,
    })
  }
  return Array.from(map.values())
}
