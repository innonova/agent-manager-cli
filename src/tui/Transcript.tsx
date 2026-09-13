import { Box, Text } from 'ink'
import { useMemo } from 'react'
import wrapAnsi from 'wrap-ansi'
import { renderItem } from '../render.js'
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

/** Wrapped lines for one item, cached by what can change its text. */
function linesOf(s: StoredItem, width: number, expanded: boolean): string[] {
  const it = s.item
  const key = `${s.index}:${s.seqTo}:${'streaming' in it ? it.streaming : ''}:${'decision' in it ? it.decision : ''}:${width}:${expanded}`
  const hit = cache.get(key)
  if (hit) return hit
  if (cache.size > 5000) cache.clear()
  const lines = wrapAnsi(renderItem(s, expanded), width, { hard: true, trim: false }).split('\n')
  cache.set(key, lines)
  return lines
}

/** All lines of a transcript, for the viewport maths. */
export function transcriptLines(
  items: (StoredItem | undefined)[],
  width: number,
  expanded: boolean,
): string[] {
  const out: string[] = []
  for (const s of items) if (s) out.push(...linesOf(s, width, expanded))
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
  const lines = useMemo(
    () => transcriptLines(items, width, expanded),
    [items, width, expanded, items.length],
  )
  const end = Math.max(0, lines.length - scrollBack)
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
          {l}
        </Text>
      ))}
      {lines.length === 0 ? <Text dimColor>No transcript yet.</Text> : null}
    </Box>
  )
}
