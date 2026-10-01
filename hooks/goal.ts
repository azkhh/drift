/**
 * One goal per project: a sentence the person wrote, and a running count of
 * whether the work since has had anything to do with it.
 *
 * "Has anything to do with it" is one meaningful word in common, between the
 * goal and either an edited path or a commit message. Crude on purpose: it
 * cannot read intent, it can only tell the person that nothing they touched
 * has mentioned the goal.
 */
export type Goal = {
  text: string
  setAt: number
  words: string[]
  /** Edits whose path shared a word with the goal, since it was set. */
  edits: number
  /** Commits whose message shared a word with the goal, since it was set. */
  commits: number
  /** When the work last met the goal. */
  touchedAt?: number
}

const FILLER = new Set(
  (
    'the and for are but not you your with from that this these those into onto over under ' +
    'then than they them their have has had been will would could should can may might just ' +
    'also more most much some any all each every what when where which who how why out off ' +
    'its our was were get got make made let lets want need keep going about again often ' +
    'thing things stuff'
  ).split(' '),
)

// Words that name where a file lives or what it is, not what it is about.
const PATH_NOISE = new Set(
  (
    'src lib app test tests spec specs index main dist build out ts tsx js jsx mjs cjs json md ' +
    'py go rs css html yml yaml txt'
  ).split(' '),
)

/**
 * One word, folded: lowercase, a plural taken to its singular, so `pages`
 * meets `page` and `retries` meets `retry`.
 */
function fold(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) {
    return `${word.slice(0, -3)}y`
  }

  if (word.length > 3 && word.endsWith('s') && !/(ss|us|is)$/.test(word)) {
    return word.slice(0, -1)
  }

  return word
}

function wordsOf(text: string): string[] {
  const spaced = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')

  return spaced
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(word => word.length >= 3)
    .map(fold)
}

/**
 * The meaningful words of a sentence or a path, folded, each once, in order.
 */
export function keywordsOf(text: string): string[] {
  const seen = new Set<string>()

  for (const word of wordsOf(text)) {
    if (!FILLER.has(word) && !PATH_NOISE.has(word)) {
      seen.add(word)
    }
  }

  return [...seen]
}

export function newGoal(text: string, now: number): Goal {
  return {
    text: text.trim(),
    setAt: now,
    words: keywordsOf(text),
    edits: 0,
    commits: 0,
  }
}

function meets(goal: Goal, text: string): boolean {
  if (goal.words.length === 0) {
    return false
  }

  const words = new Set(wordsOf(text))

  return goal.words.some(word => words.has(word))
}

/**
 * Notes an edit against the goal. `path` is relative to the project root.
 */
export function noteEdit(goal: Goal, path: string, now: number): void {
  if (meets(goal, path.replace(/\.[A-Za-z0-9]{1,5}$/, ''))) {
    goal.edits += 1
    goal.touchedAt = now
  }
}

/**
 * Notes a commit against the goal. `message` is the commit message alone.
 */
export function noteCommit(goal: Goal, message: string, now: number): void {
  if (meets(goal, message)) {
    goal.commits += 1
    goal.touchedAt = now
  }
}
