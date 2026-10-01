import { describe, expect, test } from 'claude-code/testing'

import { newGoal } from '../hooks/goal'
import {
  clearBand,
  dayKeyOf,
  emptyProject,
  recordActivity,
  recordEdit,
  recordShip,
  startSession,
} from '../hooks/tracker'

const MIN = 60_000
// Local time, so a day key does not depend on the machine's zone.
const T0 = new Date(2026, 9, 1, 10, 0, 0).getTime()
const at = (minutes: number) => T0 + minutes * MIN

const today = (p: ReturnType<typeof emptyProject>, minutes = 0) =>
  p.days[dayKeyOf(at(minutes))]

describe('tracker', () => {
  test('active time counts gaps up to ten minutes and not longer ones', () => {
    const p = emptyProject()

    recordActivity(p, at(0))
    recordActivity(p, at(4))
    recordActivity(p, at(14))
    recordActivity(p, at(26))
    recordActivity(p, at(30))

    expect(p.live.activeSinceShipMs).toBe(18 * MIN)
    expect(today(p)?.activeMs).toBe(18 * MIN)
  })

  test('a passing ship resets the clock since a ship, a failed one does not', () => {
    const p = emptyProject()

    recordActivity(p, at(0))
    recordActivity(p, at(8))
    recordShip(p, at(9), { kind: 'test', text: 'npm test' }, false)

    expect(p.live.activeSinceShipMs).toBe(9 * MIN)
    expect(today(p)?.failed).toBe(1)
    expect(today(p)?.ships.test).toBe(0)

    recordShip(p, at(10), { kind: 'commit', text: 'git commit -m x' }, true)

    expect(p.live.activeSinceShipMs).toBe(0)
    expect(today(p)?.ships.commit).toBe(1)
  })

  test('forty five active minutes without a ship says so once, then again after the next ship and the next forty five', () => {
    const p = emptyProject()
    const said: string[] = []

    for (let m = 0; m <= 90; m += 5) {
      const line = recordActivity(p, at(m))

      if (line) said.push(`${m}: ${line}`)
    }

    expect(said).toEqual(['45: 45 min since anything shipped.'])

    recordShip(p, at(91), { kind: 'push', text: 'git push' }, true)

    for (let m = 95; m <= 140; m += 5) {
      const line = recordActivity(p, at(m))

      if (line) said.push(`${m}: ${line}`)
    }

    expect(said).toEqual([
      '45: 45 min since anything shipped.',
      // The ship was at minute 91; the first event 45 active minutes on is 140 (49 min of it).
      '140: 49 min since anything shipped.',
    ])
  })

  test('idle time never reaches the threshold', () => {
    const p = emptyProject()

    for (let h = 0; h < 12; h++) {
      expect(recordActivity(p, at(h * 60))).toBeNull()
    }
  })

  test('the dark share needs ten edits, then speaks once while it stays high', () => {
    const p = emptyProject()
    const said: string[] = []

    for (let i = 0; i < 12; i++) {
      const line = recordEdit(p, at(i), `docs/note-${i}.md`, true)

      if (line) said.push(`${i + 1}: ${line}`)
    }

    expect(said).toEqual(['10: 10 of your last 10 edits were config and docs.'])
  })

  test('the dark share is rearmed once it drops, so it can cross again', () => {
    const p = emptyProject()
    const said: string[] = []
    let m = 0

    const edit = (dark: boolean) => {
      const line = recordEdit(p, at(m), `f${m}.ts`, dark)

      m += 1
      if (line) said.push(line)
    }

    for (let i = 0; i < 10; i++) edit(true)
    for (let i = 0; i < 20; i++) edit(false)

    expect(said).toHaveLength(1)

    // 12 dark of the last 20 is 60 percent.
    for (let i = 0; i < 12; i++) edit(true)

    expect(said).toHaveLength(2)
    expect(said[1]).toBe('12 of your last 20 edits were config and docs.')
  })

  test('the dark share does not fire below sixty percent', () => {
    const p = emptyProject()
    let line: string | null = null

    for (let i = 0; i < 20; i++) {
      line = recordEdit(p, at(i), `f${i}.ts`, i % 2 === 0) ?? line
    }

    expect(line).toBeNull()
  })

  test('the same file four times with nothing shipped is churn, once', () => {
    const p = emptyProject()
    const said: string[] = []

    for (let i = 0; i < 6; i++) {
      const line = recordEdit(p, at(i), 'src/app.ts', false)

      if (line) said.push(`${i + 1}: ${line}`)
    }

    expect(said).toEqual([
      '4: src/app.ts has been edited 4 times with nothing shipped.',
    ])
    expect(today(p)?.churn).toEqual(['src/app.ts'])

    recordShip(p, at(7), { kind: 'commit', text: 'git commit -m x' }, true)

    for (let i = 0; i < 4; i++) {
      const line = recordEdit(p, at(8 + i), 'src/app.ts', false)

      if (line) said.push(line)
    }

    expect(said).toHaveLength(2)
    expect(today(p)?.churn).toEqual(['src/app.ts'])
  })

  test('a second file crossing later gets its own line, the first is not repeated', () => {
    const p = emptyProject()
    let line: string | null = null

    for (let i = 0; i < 4; i++) recordEdit(p, at(i), 'a.ts', false)
    p.live.fileEdits['b.ts'] = 3
    line = recordEdit(p, at(5), 'b.ts', false)

    expect(line).toBe('b.ts has been edited 4 times with nothing shipped.')
  })

  test('time in the dark is the active time that ended on a dark edit', () => {
    const p = emptyProject()

    recordActivity(p, at(0))
    recordEdit(p, at(3), 'CLAUDE.md', true)
    recordEdit(p, at(5), 'src/a.ts', false)

    expect(today(p)?.activeMs).toBe(5 * MIN)
    expect(today(p)?.darkMs).toBe(3 * MIN)
    expect(today(p)?.darkEdits).toBe(1)
    expect(today(p)?.edits).toBe(1)
  })

  test('the band line is held until it is cleared, and a ship clears it', () => {
    const p = emptyProject()

    for (let i = 0; i < 4; i++) recordEdit(p, at(i), 'src/app.ts', false)

    expect(p.live.band).toBe(
      'src/app.ts has been edited 4 times with nothing shipped.',
    )

    clearBand(p)

    expect(p.live.band).toBeNull()

    for (let i = 0; i < 4; i++) recordEdit(p, at(10 + i), 'src/b.ts', false)
    recordShip(p, at(20), { kind: 'commit', text: 'git commit -m x' }, true)

    expect(p.live.band).toBeNull()
  })

  test('a failed ship leaves the band up', () => {
    const p = emptyProject()

    for (let i = 0; i < 4; i++) recordEdit(p, at(i), 'src/app.ts', false)
    recordShip(p, at(5), { kind: 'test', text: 'npm test' }, false)

    expect(p.live.band).not.toBeNull()
  })

  test('the lines never carry an exclamation mark, an emoji or a dash between words', () => {
    const p = emptyProject()
    const lines: string[] = []

    for (let m = 0; m <= 50; m += 5) {
      const a = recordActivity(p, at(m))
      const b = recordEdit(p, at(m), 'src/app.ts', false)

      lines.push(a ?? '', b ?? '')
    }

    for (let i = 0; i < 12; i++) lines.push(recordEdit(p, at(60 + i), `docs/${i}.md`, true) ?? '')

    const text = lines.join(' ')

    expect(text).toContain('min since anything shipped')
    expect(text).toContain('edits were config and docs')
    expect(text).not.toMatch(/!|[–—]| - |\p{Extended_Pictographic}/u)
  })

  test('a long break starts a fresh run, a short one does not', () => {
    const p = emptyProject()

    for (let i = 0; i < 4; i++) recordEdit(p, at(i), 'src/app.ts', false)
    startSession(p, at(60))

    expect(p.live.fileEdits['src/app.ts']).toBe(4)
    expect(p.live.band).toBeNull()

    startSession(p, at(60 + 9 * 60))

    expect(p.live.fileEdits).toEqual({})
    expect(p.live.window).toEqual([])
    expect(p.live.activeSinceShipMs).toBe(0)
  })

  test('a day is a local day, and days older than thirty are dropped', () => {
    const p = emptyProject()

    recordActivity(p, at(0))
    recordActivity(p, at(5))
    recordActivity(p, at(24 * 60))
    recordActivity(p, at(24 * 60 + 5))

    expect(Object.keys(p.days)).toHaveLength(2)

    recordActivity(p, at(40 * 24 * 60))

    expect(Object.keys(p.days)).toHaveLength(1)
  })

  test('with a goal set, edits and commits that share a word are noted', () => {
    const p = emptyProject()

    p.goal = newGoal('ship the pricing page', at(0))

    recordEdit(p, at(1), 'src/pages/Pricing.tsx', false)
    recordEdit(p, at(2), 'src/auth/login.ts', false)
    recordShip(p, at(3), { kind: 'commit', text: 'git commit -m "tune pricing copy"' }, true)
    recordShip(p, at(4), { kind: 'commit', text: 'git commit -m "bump deps"' }, true)

    expect(p.goal?.edits).toBe(1)
    expect(p.goal?.commits).toBe(1)
  })
})
