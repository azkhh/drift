import { commitMessageOf } from './ships'
import type { ShipHit, ShipKind } from './ships'
import { noteCommit, noteEdit } from './goal'
import type { Goal } from './goal'

/** A gap longer than this between two events is idle time, never counted. */
export const IDLE_GAP_MS = 10 * 60_000
/** Active minutes since a ship before the band speaks. */
export const TIME_WARN_MS = 45 * 60_000
/** How many of the latest edits the dark share looks at. */
export const DARK_WINDOW = 20
/** Fewest edits in the window before a dark share means anything. */
export const DARK_MIN_EDITS = 10
/** The share of the window that must be dark for the band to speak. */
export const DARK_SHARE = 0.6
/** Edits to one file, with nothing shipped between, that make it churn. */
export const CHURN_EDITS = 4
/** Days of history kept. */
export const KEEP_DAYS = 30
/** A break this long starts a fresh run: counters since a ship start over. */
export const FRESH_RUN_MS = 8 * 60 * 60_000

// Bounds, so one hook call stays small however long the session runs.
const MAX_TRACKED_FILES = 500
const MAX_CHURN_PER_DAY = 20

export type Day = {
  activeMs: number
  /** Active time whose closing event was an edit to a dark file. */
  darkMs: number
  /** Edits to the work. */
  edits: number
  /** Edits to the dark. */
  darkEdits: number
  ships: Record<ShipKind, number>
  /** Ship attempts that did not succeed. */
  failed: number
  /** Files that crossed the churn line this day. */
  churn: string[]
}

export type Live = {
  lastAt?: number
  /** Active time since the last successful ship. */
  activeSinceShipMs: number
  /** The latest edits, oldest first: 1 for the dark, 0 for the work. */
  window: number[]
  /** Edits per file since the last successful ship. */
  fileEdits: Record<string, number>
  announced: { time: boolean; dark: boolean; churn: string[] }
  /** The line the band shows now, or null while it is silent. */
  band: string | null
}

export type Project = {
  enabled: boolean
  goal?: Goal
  days: Record<string, Day>
  live: Live
}

function emptyLive(): Live {
  return {
    activeSinceShipMs: 0,
    window: [],
    fileEdits: {},
    announced: { time: false, dark: false, churn: [] },
    band: null,
  }
}

function emptyDay(): Day {
  return {
    activeMs: 0,
    darkMs: 0,
    edits: 0,
    darkEdits: 0,
    ships: { commit: 0, push: 0, deploy: 0, test: 0 },
    failed: 0,
    churn: [],
  }
}

export function emptyProject(): Project {
  return { enabled: true, days: {}, live: emptyLive() }
}

/**
 * A moment as its local calendar day, `2026-10-01`.
 */
export function dayKeyOf(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function dayOf(p: Project, at: number): Day {
  const key = dayKeyOf(at)
  let day = p.days[key]

  if (!day) {
    day = emptyDay()
    p.days[key] = day

    // The day is new: the one time history is looked at, to drop what is old.
    const oldest = dayKeyOf(at - KEEP_DAYS * 24 * 60 * 60_000)

    for (const known of Object.keys(p.days)) {
      if (known < oldest) {
        delete p.days[known]
      }
    }
  }

  return day
}

/**
 * Moves the active clock to `at`. A gap of ten minutes or less is active
 * time; a longer one is idle and counts for nothing.
 */
function advance(p: Project, at: number, isDark: boolean): void {
  const last = p.live.lastAt

  p.live.lastAt = at

  const day = dayOf(p, at)

  if (last === undefined || at <= last || at - last > IDLE_GAP_MS) {
    return
  }

  const gap = at - last

  p.live.activeSinceShipMs += gap
  day.activeMs += gap

  if (isDark) {
    day.darkMs += gap
  }
}

/**
 * The sentences for every threshold the project has crossed since the band
 * last spoke about it. A threshold speaks once per crossing: it is armed again
 * when the thing it measures drops back (a ship, a better edit mix).
 */
function crossings(p: Project, churned: string | undefined): string[] {
  const { live } = p
  const said: string[] = []

  if (live.activeSinceShipMs >= TIME_WARN_MS) {
    if (!live.announced.time) {
      live.announced.time = true
      said.push(
        `${Math.floor(live.activeSinceShipMs / 60_000)} min since anything shipped.`,
      )
    }
  } else {
    live.announced.time = false
  }

  const dark = live.window.reduce((sum, flag) => sum + flag, 0)
  const isDarkHigh =
    live.window.length >= DARK_MIN_EDITS &&
    dark / live.window.length >= DARK_SHARE

  if (isDarkHigh) {
    if (!live.announced.dark) {
      live.announced.dark = true
      said.push(
        `${dark} of your last ${live.window.length} edits were config and docs.`,
      )
    }
  } else {
    live.announced.dark = false
  }

  if (churned !== undefined) {
    const count = live.fileEdits[churned] ?? 0

    if (count >= CHURN_EDITS && !live.announced.churn.includes(churned)) {
      live.announced.churn.push(churned)
      said.push(`${churned} has been edited ${count} times with nothing shipped.`)
    }
  }

  return said
}

function raise(p: Project, said: string[]): string | null {
  if (said.length === 0) {
    return null
  }

  const line = said.join(' ')

  p.live.band = p.live.band === null ? line : `${p.live.band} ${line}`

  return line
}

/**
 * Any tool call, prompt or finished turn: the session was alive at `at`.
 * Returns the sentences the band should now add, or null.
 */
export function recordActivity(p: Project, at: number): string | null {
  advance(p, at, false)

  return raise(p, crossings(p, undefined))
}

/**
 * A successful edit. `path` is relative to the project root; `isDark` says
 * whether it is tooling, config, docs or plans.
 */
export function recordEdit(
  p: Project,
  at: number,
  path: string,
  isDark: boolean,
): string | null {
  advance(p, at, isDark)

  const { live } = p
  const day = dayOf(p, at)

  if (isDark) {
    day.darkEdits += 1
  } else {
    day.edits += 1
  }

  live.window.push(isDark ? 1 : 0)

  if (live.window.length > DARK_WINDOW) {
    live.window.shift()
  }

  const isKnown = path in live.fileEdits

  if (isKnown || Object.keys(live.fileEdits).length < MAX_TRACKED_FILES) {
    live.fileEdits[path] = (live.fileEdits[path] ?? 0) + 1
  }

  if (
    (live.fileEdits[path] ?? 0) >= CHURN_EDITS &&
    !day.churn.includes(path) &&
    day.churn.length < MAX_CHURN_PER_DAY
  ) {
    day.churn.push(path)
  }

  if (p.goal) {
    noteEdit(p.goal, path, at)
  }

  return raise(p, crossings(p, path))
}

/**
 * A ship attempt: a commit, push, deploy or test run that the Bash command
 * held. `isOk` is whether the command exited 0. A failure is counted as an
 * attempt and changes nothing else; a success resets everything measured
 * "since a ship" and silences the band.
 */
export function recordShip(
  p: Project,
  at: number,
  hit: ShipHit,
  isOk: boolean,
): null {
  advance(p, at, false)

  const day = dayOf(p, at)

  if (!isOk) {
    day.failed += 1

    return null
  }

  day.ships[hit.kind] += 1

  p.live.activeSinceShipMs = 0
  p.live.fileEdits = {}
  p.live.announced = { time: false, dark: p.live.announced.dark, churn: [] }
  p.live.band = null

  if (hit.kind === 'commit' && p.goal) {
    noteCommit(p.goal, commitMessageOf(hit.text), at)
  }

  return null
}

/** The next prompt has been sent: the band has been seen, it goes quiet. */
export function clearBand(p: Project): void {
  p.live.band = null
}

/**
 * A session begins. The band starts silent. After a long break the run is
 * fresh: nothing carried from yesterday's edits counts against today.
 */
export function startSession(p: Project, at: number): void {
  p.live.band = null

  const last = p.live.lastAt

  if (last !== undefined && at - last > FRESH_RUN_MS) {
    const { band } = p.live

    p.live = emptyLive()
    p.live.band = band
  }
}
