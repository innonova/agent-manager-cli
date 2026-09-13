import { Box, Text, useInput } from 'ink'
import { useEffect, useState } from 'react'

export interface ListProps<T> {
  items: T[]
  render: (item: T, selected: boolean) => string
  onSelect: (item: T) => void
  focus: boolean
  height: number
  empty?: string
}

/** A vertical picker: arrows or j/k move, Enter selects; scrolls to keep the cursor visible. */
export function List<T>({ items, render, onSelect, focus, height, empty }: ListProps<T>) {
  const [cursor, setCursor] = useState(0)
  useEffect(() => {
    if (cursor >= items.length) setCursor(Math.max(0, items.length - 1))
  }, [items.length, cursor])
  useInput(
    (input, key) => {
      if (key.upArrow || input === 'k') setCursor((c) => Math.max(0, c - 1))
      else if (key.downArrow || input === 'j') setCursor((c) => Math.min(items.length - 1, c + 1))
      else if (key.pageUp) setCursor((c) => Math.max(0, c - height))
      else if (key.pageDown) setCursor((c) => Math.min(items.length - 1, c + height))
      else if (key.return && items[cursor]) onSelect(items[cursor]!)
    },
    { isActive: focus },
  )
  if (items.length === 0) return <Text dimColor>{empty ?? 'nothing here'}</Text>
  const first = Math.max(0, Math.min(cursor - Math.floor(height / 2), items.length - height))
  return (
    <Box flexDirection="column">
      {items.slice(first, first + height).map((it, i) => {
        const idx = first + i
        const selected = idx === cursor
        return (
          <Text key={idx} inverse={selected && focus} wrap="truncate">
            {(selected ? '› ' : '  ') + render(it, selected)}
          </Text>
        )
      })}
    </Box>
  )
}
