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

describe('folded tool calls', async () => {
  const { transcriptLines } = await import('./tui/Transcript.tsx')
  const { renderToolCall } = await import('./render.js')
  const base = { sessionId: 's', seqFrom: 0, seqTo: 0, at: 0 }
  const call = {
    kind: 'tool_use' as const,
    id: 't1',
    name: 'Bash',
    input: { command: 'npm test', description: 'Run the tests' },
  }
  it('shows what the call was for and how it went, and folds the result under it', () => {
    const items = [
      { ...base, index: 0, item: call },
      {
        ...base,
        index: 1,
        item: {
          kind: 'tool_result' as const,
          toolUseId: 't1',
          output: 'ok\n'.repeat(700),
          isError: false,
        },
      },
      { ...base, index: 2, item: { kind: 'turn_end' as const } },
    ]
    // oxlint-disable-next-line no-control-regex
    const plain = transcriptLines(items, 80, false).map((l) => l.replace(/\x1b\[[0-9;]*m/g, ''))
    expect(plain[0]).toMatch(/⚙ Bash Run the tests\s+2\.1k chars/)
    expect(plain).toHaveLength(2) // the call line and the turn end; the result is folded
    const open = transcriptLines(items, 80, true)
    expect(open.length).toBeGreaterThan(10)
    expect(open[1]).toContain('npm test')
  })
  it('marks a running call and an error', () => {
    expect(renderToolCall({ ...base, index: 0, item: call }, call, null, false)).toContain(
      'running',
    )
    expect(
      renderToolCall(
        { ...base, index: 0, item: call },
        call,
        { kind: 'tool_result', toolUseId: 't1', output: 'boom', isError: true },
        false,
      ),
    ).toContain('error')
  })
})
