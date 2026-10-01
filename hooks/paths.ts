/**
 * The dark: edits to tooling, config, docs and plans. Everything else is the
 * work. One list, so a user can see it and replace it in one place (the
 * `darkPatterns` plugin option).
 *
 * Globs, matched against the path relative to the project root, ignoring
 * case. `*` stays inside a path segment, `**` crosses them. A pattern with no
 * slash matches a file name at any depth.
 */
export const DEFAULT_DARK_PATTERNS: readonly string[] = [
  // instructions and agent tooling
  'CLAUDE.md',
  'AGENTS.md',
  '**/.claude/**',
  // config
  '*.config.*',
  'package.json',
  'tsconfig*',
  '**/.github/**',
  // dotfiles
  '.*',
  '**/.*/**',
  // docs and plans
  'docs/**/*.md',
  '**/docs/**/*.md',
  'plan.md',
  'notes.md',
  'todo.md',
  'roadmap.md',
  'readme.md',
  // lockfiles
  '*.lock',
  '*.lockb',
  'package-lock.json',
  'pnpm-lock.yaml',
  'go.sum',
]

/**
 * Reads the `darkPatterns` option: comma or newline separated globs. Empty,
 * missing or only separators means the built in list; anything else replaces
 * it.
 */
export function parsePatterns(option: unknown): readonly string[] {
  if (typeof option !== 'string') {
    return DEFAULT_DARK_PATTERNS
  }

  const given = option
    .split(/[,\n]/)
    .map(part => part.trim())
    .filter(part => part !== '')

  return given.length === 0 ? DEFAULT_DARK_PATTERNS : given
}

/**
 * Makes an absolute path relative to the project root. A path outside the
 * root (another repository, a home directory file) is returned as it came.
 */
export function relativeTo(root: string, path: string): string {
  const base = root.replaceAll('\\', '/').replace(/\/+$/, '')
  const full = path.replaceAll('\\', '/')

  if (full === base) {
    return ''
  }

  return full.startsWith(`${base}/`) ? full.slice(base.length + 1) : full
}

/**
 * A glob as a regular expression. Compiled once per pattern: classifying a
 * path is a handful of regex tests and no disk work.
 */
const compiled = new Map<string, RegExp>()

function regexOf(glob: string): RegExp {
  const known = compiled.get(glob)

  if (known) {
    return known
  }

  let source = ''

  for (let i = 0; i < glob.length; i++) {
    const char = glob[i] as string

    if (char === '*' && glob[i + 1] === '*') {
      const isSegment = glob[i + 2] === '/'

      source += isSegment ? '(?:.*/)?' : '.*'
      i += isSegment ? 2 : 1
    } else if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }

  // No slash: a file name, wherever it sits.
  const prefix = glob.includes('/') ? '' : '(?:.*/)?'
  const regex = new RegExp(`^${prefix}${source}$`, 'i')

  compiled.set(glob, regex)

  return regex
}

/**
 * Whether an edit to this path is the dark. `path` is relative to the project
 * root where it is inside it.
 */
export function isDark(path: string, patterns: readonly string[]): boolean {
  const clean = path.replaceAll('\\', '/').replace(/^\/+/, '')

  return patterns.some(glob => regexOf(glob).test(clean))
}
