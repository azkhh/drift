import { describe, expect, test } from 'claude-code/testing'

import {
  DEFAULT_DARK_PATTERNS,
  isDark,
  parsePatterns,
  relativeTo,
} from '../hooks/paths'

describe('paths', () => {
  test('tooling, config, docs, plans and lockfiles are the dark', () => {
    for (const path of [
      'CLAUDE.md',
      'AGENTS.md',
      '.claude/settings.json',
      'packages/web/.claude/commands/ship.md',
      'vite.config.ts',
      'eslint.config.mjs',
      'package.json',
      'apps/web/package.json',
      'tsconfig.json',
      'tsconfig.build.json',
      '.github/workflows/ci.yml',
      '.gitignore',
      '.env.example',
      'docs/guide/intro.md',
      'PLAN.md',
      'notes.md',
      'TODO.md',
      'sub/roadmap.md',
      'README.md',
      'package-lock.json',
      'pnpm-lock.yaml',
      'Cargo.lock',
    ]) {
      expect(isDark(path, DEFAULT_DARK_PATTERNS), path).toBe(true)
    }
  })

  test('product code, tests and assets are the work', () => {
    for (const path of [
      'src/app.ts',
      'lib/parse.py',
      'main.go',
      'components/Button.tsx',
      'tests/app.test.ts',
      'docs/diagram.png',
      'src/notes/index.ts',
      'src/plan/parse.ts',
      'src/readme-parser.ts',
      'src/configuration.ts',
    ]) {
      expect(isDark(path, DEFAULT_DARK_PATTERNS), path).toBe(false)
    }
  })

  test('backslash paths are read as slash paths', () => {
    expect(isDark('docs\\guide\\intro.md', DEFAULT_DARK_PATTERNS)).toBe(true)
    expect(isDark('src\\app.ts', DEFAULT_DARK_PATTERNS)).toBe(false)
  })

  test('an empty or missing option keeps the built in list', () => {
    expect(parsePatterns(undefined)).toEqual(DEFAULT_DARK_PATTERNS)
    expect(parsePatterns('')).toEqual(DEFAULT_DARK_PATTERNS)
    expect(parsePatterns('  ,  ')).toEqual(DEFAULT_DARK_PATTERNS)
  })

  test('a set option replaces the built in list, it does not add to it', () => {
    const mine = parsePatterns(' marketing/**, *.draft ')

    expect(mine).toEqual(['marketing/**', '*.draft'])
    expect(isDark('marketing/launch/plan.txt', mine)).toBe(true)
    expect(isDark('notes.draft', mine)).toBe(true)
    expect(isDark('CLAUDE.md', mine)).toBe(false)
  })

  test('a path is made relative to the project root, and left alone outside it', () => {
    expect(relativeTo('/work/app', '/work/app/src/a.ts')).toBe('src/a.ts')
    expect(relativeTo('/work/app', '/work/app')).toBe('')
    expect(relativeTo('/work/app', '/work/apple/a.ts')).toBe('/work/apple/a.ts')
    expect(relativeTo('/work/app', '/home/me/.claude/settings.json')).toBe(
      '/home/me/.claude/settings.json',
    )
    expect(isDark('/home/me/.claude/settings.json', DEFAULT_DARK_PATTERNS)).toBe(
      true,
    )
  })
})
