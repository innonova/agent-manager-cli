import wrapAnsi from 'wrap-ansi'
import { describe, expect, it } from 'vitest'
import { wrapText } from './render.js'

const wrap = (t: string, w: number) => wrapAnsi(t, w, { hard: true, trim: false })

describe('wrapText', () => {
  it('gives wrapped list items a hanging indent and leaves plain text alone', () => {
    const lines = wrapText(
      '  * one two three four five six\n  1. seven eight nine ten\nplain text that wraps too',
      16,
      wrap,
    )
    expect(lines).toEqual([
      '  * one two',
      '    three four',
      '    five six',
      '  1. seven',
      '     eight nine',
      '     ten',
      'plain text that',
      'wraps too',
    ])
  })
  it('keeps ANSI styling across the wrap', () => {
    const lines = wrapText('  * \x1b[1mbold words that wrap\x1b[22m here', 14, wrap)
    expect(lines[0]).toContain('\x1b[1m')
    expect(lines[1]!.startsWith('    ')).toBe(true)
  })
})
