/**
 * What the band shows, held by the host for the session so a redraw reads it:
 * the line, or null while the band is silent.
 */
export type DriftBand = string | null

declare module 'claude-code' {
  interface PluginState {
    drift: { band: DriftBand }
  }
}
