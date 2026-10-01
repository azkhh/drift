import { describe, expect, test } from 'claude-code/testing'

import { shipsIn } from '../hooks/ships'

const kindsOf = (command: string) => shipsIn(command).map(hit => hit.kind)

describe('ships', () => {
  test('a commit is a commit, however it is spelled', () => {
    for (const command of [
      'git commit -m "add the parser"',
      'git add src/a.ts && git commit -m x',
      'git -C sub commit -am "x"',
      'git -c user.name=a commit -m x',
      'cd app && git commit --amend --no-edit',
      'FOO=1 git commit -m x',
      '(cd app && git commit -m x)',
      'git commit -m "$(cat <<\'EOF\'\nadd: the thing\n\nbody\nEOF\n)"',
    ]) {
      expect(kindsOf(command), command).toContain('commit')
    }
  })

  test('a dry run, a log and a word inside a message are not ships', () => {
    for (const command of [
      'git commit --dry-run',
      'git log --oneline',
      'git status',
      'git push --dry-run',
      'git push -n origin main',
      'echo "git commit"',
      'git diff HEAD~1 | grep "git commit"',
    ]) {
      expect(kindsOf(command), command).toEqual([])
    }
  })

  test('a separator inside a quoted message does not start a new command', () => {
    expect(kindsOf('git commit -m "tidy; git push"')).toEqual(['commit'])
    expect(kindsOf("git commit -m 'one && npm test'")).toEqual(['commit'])
  })

  test('a push is a push', () => {
    expect(kindsOf('git push')).toEqual(['push'])
    expect(kindsOf('git push origin main --force-with-lease')).toEqual(['push'])
    expect(kindsOf('git commit -m x && git push')).toEqual(['commit', 'push'])
  })

  test('deploys', () => {
    for (const command of [
      'vercel deploy',
      'vercel deploy --prod',
      'vercel --prod',
      'npx vercel deploy',
      'wrangler deploy',
      'npx wrangler deploy --env prod',
      'wrangler pages deploy dist',
      'npm publish',
      'pnpm publish --access public',
      'yarn publish',
      'fly deploy',
      'flyctl deploy --remote-only',
      'netlify deploy --prod',
    ]) {
      expect(kindsOf(command), command).toEqual(['deploy'])
    }

    for (const command of [
      'vercel dev',
      'vercel env ls',
      'vercel link',
      'npm publish --dry-run',
      'npm run build',
      'fly status',
    ]) {
      expect(kindsOf(command), command).toEqual([])
    }
  })

  test('test runs', () => {
    for (const command of [
      'npm test',
      'npm run test',
      'npm run test:unit',
      'pnpm test',
      'pnpm run test',
      'yarn test',
      'bun test',
      'pytest',
      'pytest -q tests/',
      'python -m pytest',
      'python3 -m pytest -x',
      'uv run pytest',
      'go test ./...',
      'cargo test',
      'vitest',
      'vitest run',
      'npx vitest run',
      'jest --ci',
      'npx jest',
      'CI=1 npm test -- --coverage',
    ]) {
      expect(kindsOf(command), command).toEqual(['test'])
    }

    for (const command of [
      'npm install',
      'npm run build',
      'go build ./...',
      'cargo build',
      'ls tests',
    ]) {
      expect(kindsOf(command), command).toEqual([])
    }
  })

  test('each segment of a chain counts, in order', () => {
    expect(
      kindsOf('npm test && git commit -m x && git push && vercel deploy'),
    ).toEqual(['test', 'commit', 'push', 'deploy'])
    expect(kindsOf('npm test | tail -5')).toEqual(['test'])
    expect(kindsOf('git commit -m x; git push')).toEqual(['commit', 'push'])
  })

  test('a commit hit carries the command text, for the goal check', () => {
    const [hit] = shipsIn('git commit -m "add the payment retry"')

    expect(hit?.text).toContain('payment retry')
  })

  test('a heredoc body is text, never a command', () => {
    expect(
      kindsOf("cat > notes.txt <<'EOF'\ngit push\nnpm test\nEOF"),
    ).toEqual([])
  })
})
