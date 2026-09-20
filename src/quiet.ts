import type { Item } from './types.js'

/**
 * Narration — the sentence an agent says to itself before a tool call
 * ("Let me read the file first") — is short; an answer's paragraphs and a
 * debrief's parts are longer. A text under this, and followed by a tool
 * call, is dropped from the quiet answer.
 */
export const NARRATION_MAX = 200

/**
 * What `am turn --quiet` prints of a turn: what the agent said to the
 * person, in order. Every text is included except a short one that only
 * precedes a tool call (narration). A text followed by anything else — the
 * turn's end, another text, a permission — is part of the answer and is
 * kept, so a debrief that ran a command between two paragraphs comes back
 * whole. A trailing text with nothing after it yet is undecided and left
 * for when the next item arrives; give the sequence up to the turn end for
 * the final answer.
 */
export function answerTexts(items: Item[]): string[] {
  const decides = (k: Item['kind']) =>
    k === 'text' || k === 'tool_use' || k === 'turn_end' || k === 'error' || k === 'permission'
  const out: string[] = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!
    if (it.kind !== 'text') continue
    let next: Item | undefined
    for (let j = i + 1; j < items.length; j++)
      if (decides(items[j]!.kind)) {
        next = items[j]
        break
      }
    if (!next) break // the last text, nothing after it yet: wait
    if (next.kind === 'tool_use' && it.text.length < NARRATION_MAX) continue // narration
    out.push(it.text)
  }
  return out
}
