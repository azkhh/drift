import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement, ResultOf } from 'claude-code'

export const ROOT = '/work/app'
export const MIN = 60_000
// Local time, so day keys do not depend on the machine's zone.
export const T0 = new Date(2026, 9, 1, 10, 0, 0).getTime()

/**
 * The engine beneath the mod, answered from memory: a clock, a store, a
 * session in a repository at /work/app, and every tool call succeeding unless
 * the test queues another answer. Calls the mod must never make (the network,
 * a process, a model) are recorded, not answered: the mod's `$` would throw.
 */
export function world(on: On, entries: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: T0 })
  const registered: string[] = []
  const answers: ResultOf['tool.call'][] = []
  const stored: Array<{ key: string; value: unknown }> = []
  const forbidden: string[] = []

  // A store of our own, not mock.store: a test cannot hook store.set twice,
  // and it needs to see every write.
  const memory = new Map<string, unknown>(Object.entries(entries))

  on('store.get', ($, e) => ({ value: memory.get(e.key) }))
  on('store.set', ($, e) => {
    memory.set(e.key, JSON.parse(JSON.stringify(e.value)))
    stored.push({ key: e.key, value: e.value })

    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    memory.delete(e.key)

    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...memory.keys()] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.root', () => ({ value: ROOT }))
  on('session.repo', () => ({
    value: { root: ROOT, remote: null, internal: false, name: null },
  }))
  on('command.register', ($, e) => {
    registered.push(e.name)

    return { value: { command: e.name } }
  })
  // What the engine itself draws above the prompt: an empty box.
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)

    return h(Box, {}) as RenderElement
  })
  on('tool.call', () => answers.shift() ?? { result: 'ok' })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.complete', ($, e) => ({ text: e.answer }))

  for (const event of ['http.fetch', 'process.run', 'model.complete', 'model.fork'] as const) {
    on(event, () => {
      forbidden.push(event)

      return { value: undefined } as never
    })
  }

  return { clock, registered, answers, stored, forbidden }
}

export const SESSION = {
  surface: 'terminal',
  isInteractive: true,
  cwd: ROOT,
} as const

export const edit = ($: Engine, path: string) =>
  $.tool.call({
    tool: 'Edit',
    file_path: path.startsWith('/') ? path : `${ROOT}/${path}`,
    old_string: 'a',
    new_string: 'b',
  })

export const bash = ($: Engine, command: string) =>
  $.tool.call({ tool: 'Bash', command })

export const read = ($: Engine, path: string) =>
  $.tool.call({ tool: 'Read', file_path: `${ROOT}/${path}` })

export const FAILED: ResultOf['tool.call'] = {
  isError: true,
  result: 'Exit code 1',
}

export const submit = ($: Engine, text = 'go on') =>
  $.prompt.submit({
    text,
    wait: false,
    origin: { kind: 'composer' },
  })

export const run = async ($: Engine, args = '') =>
  $.command
    .run({
      command: 'drift',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 100 },
    })
    .then(result => result.text ?? '')

/**
 * What the band above the prompt shows now, drawn on the terminal: the text
 * of its first Text, or undefined while the band is silent.
 */
export async function bandOf($: Engine): Promise<string | undefined> {
  const ui = await $.ui.mount({
    plugin: 'drift',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 6,
      bodyColumns: 100,
      scroll: { offset: 0, bodyRows: 6 },
      view: {},
    },
  })
  const found = await ui.find({ type: 'Text' })

  await ui.unmount()

  return found?.text
}
