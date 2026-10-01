import { MOVER_LINE } from './mover-line'
import { dayKeyOf } from './tracker'
import type { Day, Project } from './tracker'

const DAY_MS = 24 * 60 * 60_000
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** `2h 05m`, `38m`, `0m`. */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  const hours = Math.floor(minutes / 60)

  return hours > 0
    ? `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
    : `${minutes}m`
}

/** How long ago: `12m ago`, `5h ago`, `3 days ago`. */
export function formatAgo(ms: number): string {
  const minutes = Math.floor(Math.max(ms, 0) / 60_000)

  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h ago`

  const days = Math.floor(minutes / (24 * 60))

  return `${days} ${days === 1 ? 'day' : 'days'} ago`
}

function dateLabel(date: Date): string {
  return `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

function shippedOf(day: Day): { total: number; parts: string } {
  const { commit, push, deploy, test } = day.ships
  const parts = [
    commit > 0 ? plural(commit, 'commit', 'commits') : '',
    push > 0 ? plural(push, 'push', 'pushes') : '',
    deploy > 0 ? plural(deploy, 'deploy', 'deploys') : '',
    test > 0 ? plural(test, 'passing test run', 'passing test runs') : '',
  ].filter(part => part !== '')

  return { total: commit + push + deploy + test, parts: parts.join(', ') }
}

const row = (label: string, value: string) => `  ${label.padEnd(16)}${value}`

const EMPTY: Day = {
  activeMs: 0,
  darkMs: 0,
  edits: 0,
  darkEdits: 0,
  ships: { commit: 0, push: 0, deploy: 0, test: 0 },
  failed: 0,
  churn: [],
}

function goalLines(p: Project, now: number): string[] {
  const { goal } = p

  if (!goal) {
    return ['goal: none. /drift goal <text> sets one.']
  }

  const lines = [`goal:           ${goal.text}`]
  const met: string[] = []

  if (goal.edits > 0) met.push(plural(goal.edits, 'edit', 'edits'))
  if (goal.commits > 0) met.push(plural(goal.commits, 'commit', 'commits'))

  const when = `set ${formatAgo(now - goal.setAt)}`

  if (goal.words.length === 0) {
    lines.push(
      `  ${when}. It has no distinctive words, so nothing can be matched to it.`,
    )
  } else if (met.length === 0) {
    lines.push(
      `  ${when}. Nothing you edited or committed since has shared a word with it.`,
    )
  } else {
    const last =
      goal.touchedAt === undefined
        ? ''
        : ` The last was ${formatAgo(now - goal.touchedAt)}.`

    lines.push(
      `  ${when}. ${met.join(' and ')} have shared a word with it.${last}`,
    )
  }

  return lines
}

/**
 * The receipt `/drift` prints: today, the goal, the last seven days, and the
 * one line that closes it.
 */
export function receiptOf(p: Project, now: number): string {
  const today = p.days[dayKeyOf(now)] ?? EMPTY
  const shipped = shippedOf(today)
  const lines: string[] = []

  if (!p.enabled) {
    lines.push('drift is off for this project. /drift on turns it back on.', '')
  }

  lines.push(`drift, today ${dateLabel(new Date(now))}`)
  lines.push(row('active', formatDuration(today.activeMs)))
  lines.push(row('since last ship', `${formatDuration(p.live.activeSinceShipMs)} active`))
  lines.push(
    row(
      'shipped',
      shipped.total === 0 ? '0' : `${shipped.total} (${shipped.parts})`,
    ),
  )
  lines.push(row('in the dark', formatDuration(today.darkMs)))
  lines.push(row('edits', `work ${today.edits}, dark ${today.darkEdits}`))
  lines.push(
    row(
      'churn files',
      today.churn.length === 0
        ? '0'
        : `${today.churn.length} (${today.churn.join(', ')})`,
    ),
  )
  lines.push(row('failed tries', String(today.failed)))
  lines.push('')
  lines.push(...goalLines(p, now))
  lines.push('')
  lines.push('last 7 days')

  const rows: string[] = []
  const total = { activeMs: 0, darkMs: 0, shipped: 0, churn: 0 }
  const base = new Date(now)

  for (let back = 0; back < 7; back++) {
    const date = new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate() - back,
      12,
    )
    const day = p.days[dayKeyOf(date.getTime())]

    if (!day) continue

    const count = shippedOf(day).total

    total.activeMs += day.activeMs
    total.darkMs += day.darkMs
    total.shipped += count
    total.churn += day.churn.length
    rows.push(
      `  ${dateLabel(date).padEnd(11)}  ` +
        `active ${formatDuration(day.activeMs).padEnd(7)}  ` +
        `shipped ${String(count).padEnd(3)}  ` +
        `dark ${formatDuration(day.darkMs).padEnd(7)}  ` +
        `churn ${day.churn.length}`,
    )
  }

  if (rows.length === 0) {
    lines.push('  nothing recorded yet')
  } else {
    lines.push(...rows)
    lines.push(
      `  ${'all 7'.padEnd(11)}  ` +
        `active ${formatDuration(total.activeMs).padEnd(7)}  ` +
        `shipped ${String(total.shipped).padEnd(3)}  ` +
        `dark ${formatDuration(total.darkMs).padEnd(7)}  ` +
        `churn ${total.churn}`,
    )
  }

  lines.push('')
  lines.push(MOVER_LINE)

  return lines.join('\n')
}
