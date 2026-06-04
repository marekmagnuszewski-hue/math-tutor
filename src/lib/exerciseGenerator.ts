export type UnitType = 'numbers' | 'addition' | 'subtraction' | 'multiplication' | 'division'

export interface Exercise {
  topic: string
  question: string
  questionLatex: string
  questionImage?: string   // base64 — used for user-uploaded exercises
  hint: string
  answer: string
}

export function generateExercise(unit: UnitType, lastAnswer?: string): Exercise {
  if (unit === 'numbers') {
    let n: number
    do { n = Math.floor(Math.random() * 10) } while (String(n) === lastAnswer)
    return {
      topic: 'Liczby',
      question: `Napisz liczbę ${n}`,
      questionLatex: `${n}`,
      hint: 'Napisz ją wyraźnie, dużymi cyframi na środku tablicy',
      answer: `${n}`,
    }
  }

  if (unit === 'addition') {
    const a = Math.floor(Math.random() * 19) + 1
    const b = Math.floor(Math.random() * 19) + 1
    return {
      topic: 'Dodawanie',
      question: `Ile wynosi ${a} + ${b}?`,
      questionLatex: `${a} + ${b}`,
      hint: `Zacznij od ${a} i dodaj ${b}`,
      answer: `${a + b}`,
    }
  }

  if (unit === 'subtraction') {
    const a = Math.floor(Math.random() * 16) + 4   // 4–19
    const b = Math.floor(Math.random() * (a - 1)) + 1  // 1 to a-1
    return {
      topic: 'Odejmowanie',
      question: `Ile wynosi ${a} − ${b}?`,
      questionLatex: `${a} − ${b}`,
      hint: `Zacznij od ${a} i odejmij ${b}`,
      answer: `${a - b}`,
    }
  }

  if (unit === 'multiplication') {
    let a: number, b: number
    do {
      a = Math.floor(Math.random() * 8) + 2  // 2–9
      b = Math.floor(Math.random() * 8) + 2  // 2–9
    } while (String(a * b) === lastAnswer)
    return {
      topic: 'Mnożenie',
      question: `Ile wynosi ${a} × ${b}?`,
      questionLatex: `${a} × ${b}`,
      hint: `${a} grup po ${b}`,
      answer: String(a * b),
    }
  }

  // division — always integer quotient
  let qa: number, qb: number
  do {
    qa = Math.floor(Math.random() * 8) + 2  // 2–9 (iloraz)
    qb = Math.floor(Math.random() * 8) + 2  // 2–9 (dzielnik)
  } while (String(qa) === lastAnswer)
  return {
    topic: 'Dzielenie',
    question: `Ile wynosi ${qa * qb} ÷ ${qb}?`,
    questionLatex: `${qa * qb} ÷ ${qb}`,
    hint: `Ile razy ${qb} mieści się w ${qa * qb}?`,
    answer: String(qa),
  }
}
