import { Box, Text } from 'ink'
import wrapAnsi from 'wrap-ansi'
import { renderItem, renderToolCall, wrapText } from '../render.js'
import type { StoredItem } from '../types.js'

export interface TranscriptProps {
  items: (StoredItem | undefined)[]
  width: number
  height: number
  /** Lines scrolled up from the end; 0 follows the end. */
  scrollBack: number
  expanded: boolean
  hasEarlier: boolean
  loadingEarlier: boolean
}

const cache = new Map<string, string[]>()

/** Wrapped lines for a rendered item, cached by what can change its text. */
function wrapped(key: string, width: number, text: () => string): string[] {
  const hit = cache.get(key)
  if (hit) return hit
  if (cache.size > 5000) cache.clear()
  const lines = wrapText(text(), width, (t, w) => wrapAnsi(t, w, { hard: true, trim: false }))
  cache.set(key, lines)
  return lines
}

/** Items that start a new block get a blank line above; tool lines and markers stay attached. */
const SPACED = new Set(['user', 'text', 'permission', 'error', 'system'])

/**
 * All lines of a transcript, for the viewport maths. A tool call and its
 * result fold into one line (the result is shown under the call, not on
 * its own); a result whose call is not loaded stays a plain item.
 */
export function transcriptLines(
  items: (StoredItem | undefined)[],
  width: number,
  expanded: boolean,
): string[] {
  const results = new Map<string, StoredItem>()
  const paired = new Set<number>()
  for (const s of items)
    if (s?.item.kind === 'tool_result' && !results.has(`${s.sessionId}:${s.item.toolUseId}`))
      results.set(`${s.sessionId}:${s.item.toolUseId}`, s)
  const out: string[] = []
  for (const s of items) {
    if (!s) continue
    if (paired.has(s.index)) continue
    if (out.length && SPACED.has(s.item.kind)) out.push('')
    if (s.item.kind === 'tool_use') {
      const call = s.item
      const r = results.get(`${s.sessionId}:${call.id}`)
      const result = r?.item.kind === 'tool_result' ? r.item : null
      if (r) paired.add(r.index)
      const key = `tool:${s.sessionId}:${s.index}:${r?.index ?? '-'}:${r?.seqTo ?? ''}:${width}:${expanded}`
      out.push(...wrapped(key, width, () => renderToolCall(s, call, result, expanded)))
      continue
    }
    const it = s.item
    const key = `${s.sessionId}:${s.index}:${s.seqTo}:${'streaming' in it ? it.streaming : ''}:${'decision' in it ? it.decision : ''}:${width}:${expanded}`
    out.push(...wrapped(key, width, () => renderItem(s, expanded)))
  }
  return out
}

export function Transcript({
  items,
  width,
  height,
  scrollBack,
  expanded,
  hasEarlier,
  loadingEarlier,
}: TranscriptProps) {
  // the store mutates the array in place; the per-item cache keeps this cheap
  const lines = transcriptLines(items, width, expanded)
  const back = Math.min(scrollBack, Math.max(0, lines.length - height)) // the transcript may have shrunk (a fold)
  const end = Math.max(0, lines.length - back)
  const start = Math.max(0, end - height)
  const visible = lines.slice(start, end)
  const note =
    start === 0 && hasEarlier
      ? loadingEarlier
        ? '… loading earlier history'
        : '… earlier history above (PageUp loads it)'
      : scrollBack > 0
        ? `↑ ${scrollBack} lines below (PageDown)`
        : null
  return (
    <Box flexDirection="column" height={height}>
      {note && visible.length < height ? <Text dimColor>{note}</Text> : null}
      {visible.map((l, i) => (
        <Text key={start + i} wrap="truncate-end">
          {l === '' ? ' ' : l /* an empty text node has no height */}
        </Text>
      ))}
      {lines.length === 0 ? <Text dimColor>No transcript yet.</Text> : null}
    </Box>
  )
}
