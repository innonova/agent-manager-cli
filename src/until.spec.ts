import { describe, expect, it } from 'vitest'
import { parseUntil } from './until.js'

describe('parseUntil', () => {
  const now = new Date('2026-10-09T10:00:00').getTime()
  it('takes durations', () => {
    expect(parseUntil('45m', now)).toBe(now + 45 * 60_000)
    expect(parseUntil('2h', now)).toBe(now + 2 * 3_600_000)
    expect(parseUntil('1.5h', now)).toBe(now + 1.5 * 3_600_000)
    expect(parseUntil('1d', now)).toBe(now + 86_400_000)
  })
  it('takes a clock time, today or tomorrow', () => {
    expect(parseUntil('13:30', now)).toBe(new Date('2026-10-09T13:30:00').getTime())
    expect(parseUntil('09:00', now)).toBe(new Date('2026-10-10T09:00:00').getTime())
  })
  it('clears, and refuses nonsense', () => {
    expect(parseUntil('off', now)).toBeNull()
    expect(() => parseUntil('soon', now)).toThrow(/until what/)
    expect(() => parseUntil('25:00', now)).toThrow(/time of day/)
  })
})
