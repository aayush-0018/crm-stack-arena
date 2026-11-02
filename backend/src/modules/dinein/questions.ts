/**
 * Quick-fire questions for the table game. Made from a seed, so every player in a round gets the
 * same questions and the server can mark the answers without storing them.
 */

export const INKS = ['red', 'blue', 'green', 'orange', 'purple'] as const;
export type Ink = (typeof INKS)[number];

export interface Question {
  /** sum: "7 × 8"; ink: tap the colour the word is printed in; count: how many cups; max: tap the biggest. */
  kind: 'sum' | 'ink' | 'count' | 'max';
  prompt: string;
  /** ink: the colour the word is printed in. */
  ink?: Ink;
  /** count: how many cups to draw. */
  count?: number;
  options: string[];
}

export interface MarkedQuestion extends Question {
  /** Index into options. */
  answer: number;
}

export const QUESTION_COUNT = 60;

/** mulberry32: small, fast and the same on every machine. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
const int = (r: Rand, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: Rand, list: readonly T[]) => list[Math.floor(r() * list.length)];

function shuffle<T>(r: Rand, list: T[]) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** The right number and three close wrong ones (never negative), in random order. */
function numberOptions(r: Rand, answer: number, near: number[]) {
  const wrong = new Set<number>();
  for (const d of shuffle(r, [...near])) {
    const v = answer + d;
    if (v >= 0 && v !== answer) wrong.add(v);
    if (wrong.size === 3) break;
  }
  for (let d = 1; wrong.size < 3; d++) if (!wrong.has(answer + d)) wrong.add(answer + d);
  const options = shuffle(r, [answer, ...wrong]);
  return { options: options.map(String), answer: options.indexOf(answer) };
}

function sum(r: Rand): MarkedQuestion {
  const op = pick(r, ['+', '−', '×'] as const);
  let a: number;
  let b: number;
  let v: number;
  if (op === '×') {
    a = int(r, 3, 12);
    b = int(r, 3, 12);
    v = a * b;
  } else if (op === '+') {
    a = int(r, 12, 79);
    b = int(r, 6, 49);
    v = a + b;
  } else {
    a = int(r, 30, 99);
    b = int(r, 6, a - 5);
    v = a - b;
  }
  return { kind: 'sum', prompt: `${a} ${op} ${b}`, ...numberOptions(r, v, op === '×' ? [-a, a, -b, b, 1, -1] : [-10, 10, -1, 1, -2, 2]) };
}

function ink(r: Rand): MarkedQuestion {
  const shown = pick(r, INKS);
  const printed = pick(r, INKS.filter((c) => c !== shown));
  const others = shuffle(r, INKS.filter((c) => c !== shown && c !== printed)).slice(0, 2);
  const options = shuffle(r, [printed, shown, ...others]);
  return { kind: 'ink', prompt: shown.toUpperCase(), ink: printed, options, answer: options.indexOf(printed) };
}

function count(r: Rand): MarkedQuestion {
  const n = int(r, 3, 12);
  return { kind: 'count', prompt: 'How many cups?', count: n, ...numberOptions(r, n, [-1, 1, -2, 2]) };
}

function max(r: Rand): MarkedQuestion {
  // Look-alike numbers (e.g. 47, 74, 44, 77) so it takes a real look.
  const x = int(r, 1, 9);
  let y = int(r, 1, 9);
  if (y === x) y = (x % 9) + 1;
  const values = [...new Set([x * 10 + y, y * 10 + x, x * 11, y * 11, x * 10 + y + 1])].slice(0, 4);
  const options = shuffle(r, values);
  const best = Math.max(...options);
  return { kind: 'max', prompt: 'Tap the biggest', options: options.map(String), answer: options.indexOf(best) };
}

export function makeQuestions(seed: number, n = QUESTION_COUNT): MarkedQuestion[] {
  const r = random(seed);
  const makers = [sum, sum, ink, count, max];
  return Array.from({ length: n }, () => pick(r, makers)(r));
}

/** What players see: the questions without the answers. */
export const withoutAnswers = (qs: MarkedQuestion[]): Question[] => qs.map(({ answer: _a, ...q }) => q);

/** Right and wrong answers, in order; answers past the end are ignored. */
export function mark(seed: number, answers: number[]) {
  const qs = makeQuestions(seed);
  let correct = 0;
  let wrong = 0;
  answers.slice(0, qs.length).forEach((a, i) => (a === qs[i].answer ? correct++ : wrong++));
  return { correct, wrong, score: Math.max(0, correct - wrong) };
}
