import { describe, expect, test } from 'claude-code/testing'

import { formatAgo, formatDuration } from '../hooks/receipt'

describe('receipt', () => {
  test('a duration reads in hours and minutes, and a short one says it is short', () => {
    expect(formatDuration(0)).toBe('0m')
    expect(formatDuration(13_000)).toBe('<1m')
    expect(formatDuration(60_000)).toBe('1m')
    expect(formatDuration(38 * 60_000)).toBe('38m')
    expect(formatDuration(125 * 60_000)).toBe('2h 05m')
  })

  test('how long ago reads in minutes, hours and days', () => {
    expect(formatAgo(5 * 60_000)).toBe('5m ago')
    expect(formatAgo(5 * 60 * 60_000)).toBe('5h ago')
    expect(formatAgo(24 * 60 * 60_000)).toBe('1 day ago')
    expect(formatAgo(3 * 24 * 60 * 60_000)).toBe('3 days ago')
  })
})
