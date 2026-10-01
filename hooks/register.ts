import type { EngineInterface, Register, RenderElement } from 'claude-code'

import { newGoal } from './goal'
import { isDark, parsePatterns, relativeTo } from './paths'
import { receiptOf } from './receipt'
import { shipsIn } from './ships'
import {
  clearBand,
  emptyLive,
  recordActivity,
  recordEdit,
  recordShip,
  reviveProject,
  startSession,
} from './tracker'
import type { Project } from './tracker'

// A literal reference, as `$.state` requires: the host holds the band's line
// so a redraw reads it and a write redraws exactly the readers.
const BAND = { plugin: 'drift', key: 'band' } as const

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

// A prompt the person typed, as opposed to a notification or a plugin's own.
const PERSON_ORIGINS = new Set(['composer', 'bridge', 'sdk', 'unclassified'])

const USAGE =
  'drift takes: /drift (today and the last 7 days), /drift goal <text>, ' +
  '/drift goal clear, /drift off, /drift on, /drift reset.'

type Context = {
  /** Where the session stood when this was resolved, to notice a move. */
  sessionRoot: string
  key: string
  project: Project
  /** The line last written to the band, so an unchanged one is not rewritten. */
  shown: string | null
}

type Engine = EngineInterface

/**
 * The project the session is in, from the store, keyed by the repository
 * root. Resolved again only when the session's root moves.
 */
async function projectOf(
  $: Engine,
  held: Context | undefined,
): Promise<Context> {
  const sessionRoot = await $.session.root()

  if (held && held.sessionRoot === sessionRoot) {
    return held
  }

  const repo = await $.session.repo().catch(() => null)
  const key = `p:${repo?.root ?? sessionRoot}`

  return {
    sessionRoot,
    key,
    project: reviveProject(await $.store.get(key)),
    shown: null,
  }
}

function pathOf(input: Record<string, unknown>): string | undefined {
  const path = input.file_path ?? input.notebook_path

  return typeof path === 'string' ? path : undefined
}

/**
 * Whether a Bash result is a command that finished and exited 0. The engine
 * sets `isError` when the tool reported an error, which a non zero exit is;
 * a command sent to the background has not finished, so has not shipped.
 */
function isFinishedOk(result: { isError?: true; result?: unknown }): boolean {
  if (result.isError === true) {
    return false
  }

  const done = result.result

  if (typeof done === 'object' && done !== null) {
    const record = done as Record<string, unknown>

    return !record.backgroundTaskId && record.interrupted !== true
  }

  return true
}

type Holder = { current?: Context }

async function context($: Engine, holder: Holder): Promise<Context> {
  holder.current = await projectOf($, holder.current)

  return holder.current
}

async function persist($: Engine, c: Context): Promise<void> {
  await $.store.set(c.key, c.project)
}

async function showBand($: Engine, c: Context): Promise<void> {
  const line = c.project.enabled ? c.project.live.band : null

  if (line !== c.shown) {
    c.shown = line
    await $.state.set(BAND, line)
  }
}

export const register: Register = (on, options) => {
  const patterns = parsePatterns(options.darkPatterns)
  // Per load of the module, never module level: a fresh load starts clean.
  const holder: Holder = {}

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'drift',
        description:
          'Are you moving or hiding in the dark? Today, the last 7 days, your goal.',
        argumentHint: '[goal <text> | off | on | reset]',
      })

      const c = await context($, holder)

      startSession(c.project, await $.clock.now())
      await showBand($, c)
    } catch {
      // A mod must never stop a session from starting.
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    try {
      const c = await context($, holder)

      await persist($, c)
    } catch {
      // Nothing to do at the end of a session but let it end.
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    try {
      const c = await context($, holder)

      if (c.project.enabled) {
        recordActivity(c.project, await $.clock.now())

        if (PERSON_ORIGINS.has(e.origin.kind)) {
          clearBand(c.project)
        }

        await showBand($, c)
      }
    } catch {
      // The prompt goes through whatever happened here.
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    try {
      const c = await context($, holder)

      if (c.project.enabled) {
        recordActivity(c.project, await $.clock.now())

        await showBand($, c)

        if (e.agentId === undefined) await persist($, c)
      }
    } catch {
      // The turn is over either way.
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)

    try {
      const c = await context($, holder)

      if (!c.project.enabled) {
        return result
      }

      const now = await $.clock.now()
      const tool = String(e.tool)
      const input = e as unknown as Record<string, unknown>
      const hasLanded = result.deny === undefined && result.isError !== true
      let hasShipAttempt = false

      if (EDIT_TOOLS.has(tool) && hasLanded) {
        const path = pathOf(input)

        if (path !== undefined) {
          const relative = relativeTo(c.sessionRoot, path)

          recordEdit(c.project, now, relative, isDark(relative, patterns))
        } else {
          recordActivity(c.project, now)
        }
      } else if (tool === 'Bash' && typeof input.command === 'string') {
        const hits = shipsIn(input.command)

        if (hits.length === 0 || result.deny !== undefined) {
          recordActivity(c.project, now)
        } else {
          const isOk = isFinishedOk(result)

          for (const hit of hits) {
            recordShip(c.project, now, hit, isOk)
          }

          hasShipAttempt = true
        }
      } else {
        recordActivity(c.project, now)
      }

      await showBand($, c)

      // What shipped is on disk before the next thing happens.
      if (hasShipAttempt) await persist($, c)
    } catch {
      // Counting must never break a tool call.
    }

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { value } = await $.state.get(BAND)

    if (!value) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    return h(Box, null, h(Text, null, value)) as RenderElement
  })

  on('command.run', { command: 'drift' }, async ($, e) => {
    const c = await context($, holder)
    const now = await $.clock.now()
    const [word = '', ...rest] = e.args.trim().split(/\s+/)
    const text = rest.join(' ').trim()

    switch (word.toLowerCase()) {
      case '':
        return { text: receiptOf(c.project, now) }

      case 'off':
        c.project.enabled = false
        c.project.live.band = null
        await showBand($, c)
        await persist($, c)

        return {
          text: 'drift is off for this project. /drift on turns it back on.',
        }

      case 'on':
        c.project.enabled = true
        await persist($, c)

        return { text: 'drift is on for this project.' }

      case 'reset':
        c.project.days = {}
        c.project.live = emptyLive()
        await showBand($, c)
        await persist($, c)

        return {
          text: 'drift reset for this project: counters and history cleared, goal and on/off kept.',
        }

      case 'goal': {
        if (text === '') {
          const { goal } = c.project

          return {
            text: goal
              ? `goal: ${goal.text}`
              : 'no goal set. /drift goal <text> sets one.',
          }
        }

        if (text.toLowerCase() === 'clear') {
          c.project.goal = undefined
          await persist($, c)

          return { text: 'goal cleared.' }
        }

        c.project.goal = newGoal(text, now)
        await persist($, c)

        return { text: `goal set: ${c.project.goal.text}` }
      }

      default:
        return { text: `unknown: ${word}. ${USAGE}` }
    }
  })
}
