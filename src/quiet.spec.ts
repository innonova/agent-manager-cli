import { describe, expect, it } from 'vitest'
import type { Item } from './types.js'
import { answerTexts } from './quiet.js'

const text = (t: string): Item => ({ kind: 'text', text: t, streaming: false })
const tool = (): Item => ({ kind: 'tool_use', id: 'x', name: 'Bash', input: {} })
const result = (): Item => ({ kind: 'tool_result', toolUseId: 'x', output: '', isError: false })
const thinking = (): Item => ({ kind: 'thinking', text: 'hmm' })
const end = (): Item => ({ kind: 'turn_end' })

const para = (c: string) => c.repeat(260) // an answer's paragraph: well over the narration cutoff

describe('answerTexts: the quiet answer', () => {
  it('drops a short narration before a tool call, keeps the real answer after it', () => {
    // learnings #45: "Let me read the file first" then a tool call
    const seq = [
      text('Let me read the feature file first.'),
      thinking(),
      tool(),
      result(),
      text('The plan: record the commit against the turn, then join it in the list.'),
      end(),
    ]
    expect(answerTexts(seq)).toEqual([
      'The plan: record the commit against the turn, then join it in the list.',
    ])
  })

  it('keeps a debrief whole: several answer paragraphs with tool calls (am learn) between', () => {
    // learnings #42: the answer wrote paragraphs, ran am learn between them, closed with one line
    const a = para('a')
    const b = para('b')
    const c = 'And that is the debrief.'
    const seq = [text(a), tool(), result(), text(b), tool(), result(), text(c), end()]
    expect(answerTexts(seq)).toEqual([a, b, c])
  })

  it('keeps a long text even before a tool call (a quoted helper report the agent then acts on)', () => {
    const report = para('r')
    expect(answerTexts([text(report), tool(), end()])).toEqual([report])
  })

  it('holds a trailing text until the turn ends, then prints it', () => {
    expect(answerTexts([tool(), result(), text('42')])).toEqual([]) // undecided
    expect(answerTexts([tool(), result(), text('42'), end()])).toEqual(['42']) // decided by the end
  })

  it('keeps a short text that is not followed by a tool call', () => {
    expect(answerTexts([text('hi'), text('bye'), end()])).toEqual(['hi', 'bye'])
  })
})
