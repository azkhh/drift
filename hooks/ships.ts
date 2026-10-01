export type ShipKind = 'commit' | 'push' | 'deploy' | 'test'

export type ShipHit = {
  kind: ShipKind
  /**
   * The text of the command that made the hit, quotes and all. A commit's
   * message is in it; the goal check reads it.
   */
  text: string
}

/**
 * Cuts a shell command line into its commands: at `&&`, `||`, `;`, `|`, `&`
 * and newlines, never inside quotes, and with the body of an unquoted heredoc
 * dropped (it is text for the command above it, not a command).
 *
 * Not a shell parser. It is enough to tell `git commit -m "a; b"` (one
 * command) from `git commit -m a; git push` (two).
 */
function segmentsOf(line: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: '"' | "'" | '`' | null = null
  let i = 0

  const flush = () => {
    if (current.trim() !== '') {
      out.push(current.trim())
    }
    current = ''
  }

  while (i < line.length) {
    const char = line[i] as string
    const next = line[i + 1]

    if (quote) {
      current += char

      if (char === '\\' && quote !== "'" && next !== undefined) {
        current += next
        i += 2
        continue
      }

      if (char === quote) {
        quote = null
      }

      i++
      continue
    }

    if (char === '\\' && next !== undefined) {
      current += char + next
      i += 2
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char
      current += char
      i++
      continue
    }

    if (char === '<' && next === '<' && line[i + 2] !== '<') {
      const heredoc = /^<<(-?)\s*(['"]?)([A-Za-z_][\w-]*)\2/.exec(line.slice(i))

      if (heredoc) {
        const [whole, dash, , word] = heredoc as unknown as [
          string,
          string,
          string,
          string,
        ]
        const restOfLine = line.indexOf('\n', i)

        current += whole
        i += whole.length

        if (restOfLine === -1) {
          continue
        }

        // Keep what follows the delimiter on the same line, then skip the body.
        const tail = line.slice(i, restOfLine)
        current += tail
        flush()

        let at = restOfLine + 1

        while (at < line.length) {
          const end = line.indexOf('\n', at)
          const row = line.slice(at, end === -1 ? line.length : end)
          const isEnd = (dash ? row.trim() : row) === word

          at = end === -1 ? line.length : end + 1

          if (isEnd) {
            break
          }
        }

        i = at
        continue
      }
    }

    if (char === '\n' || char === ';') {
      flush()
      i++
      continue
    }

    if (char === '&' || char === '|') {
      flush()
      i += next === char ? 2 : 1
      continue
    }

    current += char
    i++
  }

  flush()

  return out
}

/**
 * A segment as words, quotes removed from around each. `git commit -m "a b"`
 * is `git`, `commit`, `-m`, `a b`.
 */
function wordsOf(segment: string): string[] {
  const words: string[] = []
  let current = ''
  let has = false
  let quote: '"' | "'" | null = null

  for (let i = 0; i < segment.length; i++) {
    const char = segment[i] as string

    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      has = true
    } else if (/\s/.test(char)) {
      if (has || current !== '') {
        words.push(current)
      }
      current = ''
      has = false
    } else {
      current += char
      has = true
    }
  }

  if (has || current !== '') {
    words.push(current)
  }

  return words
}

const WRAPPERS = new Set(['time', 'sudo', 'nice', 'command', 'env', 'exec'])
const RUNNERS = new Set(['npx', 'bunx'])
const RUNNER_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['pnpm', 'exec'],
  ['pnpm', 'dlx'],
  ['yarn', 'dlx'],
  ['uv', 'run'],
  ['poetry', 'run'],
  ['python', '-m'],
  ['python3', '-m'],
]

/**
 * What the command is, with env assignments, `sudo`-like wrappers, a leading
 * `(` and runners (`npx`, `uv run`, `python -m`) taken off the front.
 */
function headOf(words: string[]): string[] {
  let rest = words.slice()

  for (let guard = 0; guard < 8; guard++) {
    const first = (rest[0] ?? '').replace(/^[({]+/, '')

    if (first === '') {
      rest = rest.slice(1)
      if (rest.length === 0) break
      continue
    }

    rest[0] = first

    if (/^[A-Za-z_]\w*=/.test(first) || WRAPPERS.has(first)) {
      rest = rest.slice(1)
      continue
    }

    if (RUNNERS.has(first)) {
      rest = rest.slice(1)
      while ((rest[0] ?? '').startsWith('-')) rest = rest.slice(1)
      continue
    }

    const pair = RUNNER_PAIRS.find(
      ([a, b]) => a === first && rest[1] === b,
    )

    if (pair) {
      rest = rest.slice(2)
      continue
    }

    break
  }

  return rest
}

// git options that take a value in the next word.
const GIT_VALUE_OPTIONS = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
])

function gitSubcommandOf(words: string[]): string | undefined {
  for (let i = 1; i < words.length; i++) {
    const word = words[i] as string

    if (GIT_VALUE_OPTIONS.has(word)) {
      i++
    } else if (!word.startsWith('-')) {
      return word
    }
  }

  return undefined
}

function firstPlainWord(words: string[], from: number): string | undefined {
  return words.slice(from).find(word => !word.startsWith('-'))
}

function kindOf(words: string[]): ShipKind | undefined {
  const head = headOf(words)
  const name = head[0]

  if (name === undefined) {
    return undefined
  }

  const isDry = head.some(word => word === '--dry-run')

  switch (name) {
    case 'git': {
      const sub = gitSubcommandOf(head)

      if (sub === 'commit' && !isDry) return 'commit'
      if (sub === 'push' && !isDry && !head.includes('-n')) return 'push'

      return undefined
    }
    case 'vercel': {
      const sub = firstPlainWord(head, 1)

      return sub === undefined || sub === 'deploy' ? 'deploy' : undefined
    }
    case 'wrangler':
      return (head.includes('deploy') || head.includes('publish')) && !isDry
        ? 'deploy'
        : undefined
    case 'fly':
    case 'flyctl':
    case 'netlify':
      return firstPlainWord(head, 1) === 'deploy' ? 'deploy' : undefined
    case 'npm':
    case 'pnpm':
    case 'yarn':
    case 'bun': {
      const sub = head[1]

      if (sub === 'publish') return isDry ? undefined : 'deploy'
      if (sub === 'test' || sub === 't') return 'test'

      if (sub === 'run' || sub === 'run-script') {
        return /^test(:|$)/.test(head[2] ?? '') ? 'test' : undefined
      }

      return undefined
    }
    case 'pytest':
    case 'py.test':
    case 'vitest':
    case 'jest':
      return 'test'
    case 'go':
    case 'cargo':
      return head[1] === 'test' ? 'test' : undefined
    default:
      return undefined
  }
}

/**
 * The ships a Bash command line holds, in order: commits, pushes, deploys and
 * test runs. A line with no ship is an empty list. Whether the line then
 * exited 0 is the caller's to say, from the tool's result.
 */
export function shipsIn(command: string): ShipHit[] {
  const hits: ShipHit[] = []

  for (const segment of segmentsOf(command)) {
    const kind = kindOf(wordsOf(segment))

    if (kind) {
      hits.push({ kind, text: segment })
    }
  }

  return hits
}

/**
 * The message of a `git commit` command: what follows each `-m`, `-am` or
 * `--message`, joined with a space. Empty when the commit took its message
 * from elsewhere (`--no-edit`, `-F`, the editor).
 */
export function commitMessageOf(text: string): string {
  const words = wordsOf(text)
  const parts: string[] = []

  for (let i = 0; i < words.length; i++) {
    const word = words[i] as string
    const inline = /^--message=(.*)$/s.exec(word)

    if (inline) {
      parts.push(inline[1] as string)
    } else if (/^-[A-Za-z]*m$/.test(word) || word === '--message') {
      const value = words[i + 1]

      if (value !== undefined) {
        parts.push(value)
        i++
      }
    }
  }

  return parts.join(' ')
}
