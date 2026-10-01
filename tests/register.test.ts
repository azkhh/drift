import { describe, expect, test } from 'claude-code/testing'

import { MOVER_LINE } from '../hooks/mover-line'
import {
  FAILED,
  MIN,
  ROOT,
  SESSION,
  T0,
  bandOf,
  bash,
  edit,
  read,
  run,
  submit,
  world,
} from './fixtures/world'

describe('register', () => {
  test('/drift is registered when the session starts', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)

    expect(w.registered).toEqual(['drift'])
  })

  test('while you are moving the band is silent', async ($, on) => {
    world(on)

    await $.session.start(SESSION)
    await edit($, 'src/a.ts')
    await bash($, 'git add src/a.ts && git commit -m "add a"')
    await edit($, 'src/b.ts')
    await edit($, 'src/c.ts')

    expect(await bandOf($)).toBeUndefined()
  })

  test('a file edited four times with nothing shipped puts one line in the band, once', async ($, on) => {
    world(on)

    await $.session.start(SESSION)
    await edit($, 'src/app.ts')
    await edit($, 'src/app.ts')
    await edit($, 'src/app.ts')

    expect(await bandOf($), 'three edits are not churn').toBeUndefined()

    await edit($, 'src/app.ts')

    expect(await bandOf($)).toBe(
      'src/app.ts has been edited 4 times with nothing shipped.',
    )

    await edit($, 'src/app.ts')
    await edit($, 'src/app.ts')

    expect(await bandOf($), 'the same crossing does not speak again').toBe(
      'src/app.ts has been edited 4 times with nothing shipped.',
    )
  })

  test('the next prompt takes the line away and it does not come back', async ($, on) => {
    world(on)

    await $.session.start(SESSION)
    for (let i = 0; i < 4; i++) await edit($, 'src/app.ts')

    expect(await bandOf($)).toBeDefined()

    await submit($)

    expect(await bandOf($)).toBeUndefined()

    await edit($, 'src/app.ts')
    await submit($)

    expect(await bandOf($)).toBeUndefined()
  })

  test('a commit that went through puts the band away', async ($, on) => {
    world(on)

    await $.session.start(SESSION)
    for (let i = 0; i < 4; i++) await edit($, 'src/app.ts')
    await bash($, 'git commit -am "tidy"')

    expect(await bandOf($)).toBeUndefined()
  })

  test('a commit that failed leaves it up and is counted as a failed try', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    for (let i = 0; i < 4; i++) await edit($, 'src/app.ts')
    w.answers.push(FAILED)
    await bash($, 'git commit -am "tidy"')

    expect(await bandOf($)).toBeDefined()
    expect(await run($)).toMatch(/failed tries\s+1/)
    expect(await run($)).toMatch(/shipped\s+0/)
  })

  test('a command that ran in the background has not shipped yet', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    w.answers.push({
      result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' },
    })
    await bash($, 'npm test')

    expect(await run($)).toMatch(/shipped\s+0/)
  })

  test('forty five active minutes with nothing shipped says so, with the minutes', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)

    for (let m = 0; m < 45; m += 5) {
      await read($, 'src/a.ts')
      await w.clock.advance(5 * MIN)
    }

    expect(await bandOf($), 'forty minutes in').toBeUndefined()

    await read($, 'src/a.ts')

    expect(await bandOf($)).toBe('45 min since anything shipped.')

    await w.clock.advance(5 * MIN)
    await read($, 'src/a.ts')

    expect(await bandOf($), 'not again every turn').toBe(
      '45 min since anything shipped.',
    )

    await submit($)

    expect(await bandOf($)).toBeUndefined()
  })

  test('an hour away from the keyboard is not drift', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await read($, 'src/a.ts')
    await w.clock.advance(60 * MIN)
    await read($, 'src/a.ts')
    await w.clock.advance(60 * MIN)
    await read($, 'src/a.ts')

    expect(await bandOf($)).toBeUndefined()
    expect(await run($)).toMatch(/active\s+0m/)
  })

  test('most of your last edits going to config and docs is named', async ($, on) => {
    world(on)

    await $.session.start(SESSION)
    for (let i = 0; i < 9; i++) await edit($, `docs/page-${i}.md`)

    expect(await bandOf($), 'nine edits are not enough to say').toBeUndefined()

    await edit($, 'CLAUDE.md')

    expect(await bandOf($)).toBe('10 of your last 10 edits were config and docs.')
  })

  test('the two lines come as one band, in the order of the example', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    for (let i = 0; i < 9; i++) {
      await edit($, `docs/page-${i}.md`)
      await w.clock.advance(5 * MIN)
    }
    await edit($, 'CLAUDE.md')

    // Nine edits crossed 45 active minutes on the way: the minutes line came
    // first, the dark share line completes the band at the tenth edit.
    expect(await bandOf($)).toBe(
      '45 min since anything shipped. 10 of your last 10 edits were config and docs.',
    )
  })

  test('an edit that failed or was refused counts for nothing', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    for (let i = 0; i < 4; i++) {
      w.answers.push(i % 2 === 0 ? FAILED : { deny: 'not allowed' })
      await edit($, 'src/app.ts')
    }

    expect(await bandOf($)).toBeUndefined()
    expect(await run($)).toMatch(/edits\s+work 0, dark 0/)
  })

  test('the option says what the dark is: marketing files become the dark', { options: { darkPatterns: 'marketing/**' } }, async ($, on) => {
    world(on)

    await $.session.start(SESSION)
    for (let i = 0; i < 10; i++) await edit($, `marketing/post-${i}.txt`)

    expect(await bandOf($)).toBe('10 of your last 10 edits were config and docs.')
  })

  test('with the option set, CLAUDE.md is the work', { options: { darkPatterns: 'marketing/**' } }, async ($, on) => {
    world(on)

    await $.session.start(SESSION)
    for (let i = 0; i < 10; i++) await edit($, 'CLAUDE.md')

    expect(await bandOf($)).toBe(
      'CLAUDE.md has been edited 4 times with nothing shipped.',
    )
  })

  test('/drift prints today, the goal line and ends on the one constant', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await read($, 'src/a.ts')
    await w.clock.advance(5 * MIN)
    await edit($, 'src/a.ts')
    await w.clock.advance(5 * MIN)
    await edit($, 'CLAUDE.md')
    await bash($, 'git commit -am "add a"')
    await bash($, 'git push')
    await bash($, 'npm test')
    w.answers.push(FAILED)
    await bash($, 'npm test')

    const text = await run($)
    const lines = text.trimEnd().split('\n')

    expect(text).toMatch(/active\s+10m/)
    expect(text).toMatch(/shipped\s+3 \(1 commit, 1 push, 1 passing test run\)/)
    expect(text).toMatch(/failed tries\s+1/)
    expect(text).toMatch(/edits\s+work 1, dark 1/)
    expect(text).toMatch(/in the dark\s+5m/)
    expect(text).toMatch(/goal:\s+none/)
    expect(lines.at(-1)).toBe(MOVER_LINE)
    expect(lines.slice(0, -1).join('\n')).not.toContain(MOVER_LINE)
  })

  test('the band never carries the mover line, and /drift off silences it', async ($, on) => {
    world(on)

    await $.session.start(SESSION)
    for (let i = 0; i < 4; i++) await edit($, 'src/app.ts')

    expect(await bandOf($)).not.toContain(MOVER_LINE)
    expect(await run($, 'off')).toMatch(/off/)
    expect(await bandOf($)).toBeUndefined()
  })

  test('/drift off counts nothing, /drift on starts again', async ($, on) => {
    world(on)

    await $.session.start(SESSION)
    await run($, 'off')
    for (let i = 0; i < 5; i++) await edit($, 'src/app.ts')
    await bash($, 'git commit -am "x"')

    const whileOff = await run($)

    expect(whileOff).toMatch(/drift is off/)
    expect(whileOff).toMatch(/shipped\s+0/)
    expect(await bandOf($)).toBeUndefined()

    expect(await run($, 'on')).toMatch(/on/)
    for (let i = 0; i < 4; i++) await edit($, 'src/app.ts')

    expect(await bandOf($)).toBeDefined()
    expect(await run($)).not.toMatch(/drift is off/)
  })

  test('/drift goal stores one goal and the receipt says whether the work has met it', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)

    expect(await run($, 'goal ship the pricing page')).toMatch(
      /goal set: ship the pricing page/,
    )
    expect(await run($)).toMatch(/goal:\s+ship the pricing page/)
    expect(await run($)).toMatch(/Nothing you edited or committed since has shared a word with it/)

    await w.clock.advance(5 * MIN)
    await edit($, 'src/pages/Pricing.tsx')
    await bash($, 'git commit -am "tune pricing copy"')

    expect(await run($)).toMatch(/1 edit and 1 commit have shared a word with it/)

    expect(await run($, 'goal')).toMatch(/ship the pricing page/)
    expect(await run($, 'goal clear')).toMatch(/goal cleared/)
    expect(await run($)).toMatch(/goal:\s+none/)
  })

  test('the goal is kept by the repository root, not by the session', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await run($, 'goal ship it')

    expect(w.stored.some(row => row.key === `p:${ROOT}`)).toBe(true)
  })

  test('/drift reset clears the counters and the history and keeps the goal and the switch', async ($, on) => {
    world(on)

    await $.session.start(SESSION)
    await run($, 'goal ship the pricing page')
    for (let i = 0; i < 4; i++) await edit($, 'src/app.ts')
    await bash($, 'git commit -am "x"')

    expect(await run($, 'reset')).toMatch(/reset/)

    const after = await run($)

    expect(after).toMatch(/shipped\s+0/)
    expect(after).toMatch(/edits\s+work 0, dark 0/)
    expect(after).toMatch(/goal:\s+ship the pricing page/)
  })

  test('an unknown word after /drift says what it takes', async ($, on) => {
    world(on)

    await $.session.start(SESSION)

    expect(await run($, 'banana')).toMatch(/\/drift goal <text>/)
  })

  test('a ship is written to the store at once, so a crash loses nothing that shipped', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await bash($, 'git commit -am "x"')

    const last = w.stored.at(-1)

    expect(last?.key).toBe(`p:${ROOT}`)
    expect(JSON.stringify(last?.value)).toContain('"commit":1')
  })

  test('yesterday and the days before come back from the store', async ($, on) => {
    const day = (daysAgo: number) => {
      const d = new Date(T0 - daysAgo * 24 * 60 * MIN)
      const pad = (n: number) => String(n).padStart(2, '0')

      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    }
    const stats = (activeMs: number, commits: number) => ({
      activeMs,
      darkMs: 20 * MIN,
      edits: 10,
      darkEdits: 4,
      ships: { commit: commits, push: 0, deploy: 0, test: 0 },
      failed: 0,
      churn: ['src/old.ts'],
    })

    world(on, {
      [`p:${ROOT}`]: {
        enabled: true,
        goal: {
          text: 'ship the pricing page',
          setAt: T0 - 3 * 24 * 60 * MIN,
          words: ['ship', 'pricing', 'page'],
          edits: 4,
          commits: 1,
        },
        days: { [day(1)]: stats(90 * MIN, 3), [day(2)]: stats(30 * MIN, 0) },
        live: {
          activeSinceShipMs: 0,
          window: [],
          fileEdits: {},
          announced: { time: false, dark: false, churn: [] },
          band: null,
        },
      },
    })

    await $.session.start(SESSION)

    const text = await run($)

    expect(text).toMatch(/last 7 days/)
    expect(text).toMatch(/active 1h 30m\s+shipped 3\s+dark 20m\s+churn 1/)
    expect(text).toMatch(/active 30m\s+shipped 0/)
    expect(text).toMatch(/set 3 days ago/)
    expect(text).toMatch(/4 edits and 1 commit have shared a word with it/)
  })

  test('nothing is sent anywhere and no model is asked, whatever happens', async ($, on) => {
    const w = world(on)

    await $.session.start(SESSION)
    await submit($)
    for (let i = 0; i < 12; i++) await edit($, `docs/${i}.md`)
    await bash($, 'git commit -am "x" && git push && vercel deploy')
    await run($)
    await run($, 'goal x')
    await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })

    expect(w.forbidden).toEqual([])
  })
})
