import { Box, Text, useInput } from 'ink'
import { useState } from 'react'

export interface ComposerProps {
  value: string
  onChange: (v: string) => void
  onSubmit: (v: string) => void
  focus: boolean
  placeholder?: string
  /** Rows shown at most; the cursor's line is always among them. */
  maxRows?: number
}

/**
 * A multi-line input. Enter sends; Shift+Enter, Alt+Enter or Ctrl+J
 * inserts a newline (Shift+Enter only when the terminal sends a distinct
 * sequence for it; see the README); pasted text keeps its newlines. Control combinations are left to the
 * screen around it.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  focus,
  placeholder,
  maxRows = 6,
}: ComposerProps) {
  const [cursor, setCursor] = useState(value.length)
  const at = Math.min(cursor, value.length)
  const set = (v: string, c: number) => {
    onChange(v)
    setCursor(Math.max(0, Math.min(c, v.length)))
  }
  useInput(
    (input, key) => {
      if (key.ctrl && input !== '\n') return
      if (key.tab || key.escape || key.pageUp || key.pageDown) return
      // Shift+Enter (CSI u: return+shift; xterm modifyOtherKeys: raw), Alt+Enter, Ctrl+J
      const newline =
        (key.return && (key.shift || key.meta)) || input === '\n' || input === '[27;2;13~'
      if (newline) return set(value.slice(0, at) + '\n' + value.slice(at), at + 1)
      if (key.return) {
        if (value.trim()) onSubmit(value)
        return
      }
      if (key.backspace || (key.delete && at > 0 && !key.meta && input === '')) {
        if (at === 0) return
        return set(value.slice(0, at - 1) + value.slice(at), at - 1)
      }
      if (key.leftArrow) return setCursor(Math.max(0, at - 1))
      if (key.rightArrow) return setCursor(Math.min(value.length, at + 1))
      if (key.home) return setCursor(value.lastIndexOf('\n', at - 1) + 1)
      if (key.end) {
        const nl = value.indexOf('\n', at)
        return setCursor(nl < 0 ? value.length : nl)
      }
      if (key.upArrow || key.downArrow) {
        const lineStart = value.lastIndexOf('\n', at - 1) + 1
        const col = at - lineStart
        if (key.upArrow) {
          if (lineStart === 0) return
          const prevStart = value.lastIndexOf('\n', lineStart - 2) + 1
          return setCursor(Math.min(prevStart + col, lineStart - 1))
        }
        const nl = value.indexOf('\n', at)
        if (nl < 0) return
        const nextEnd = value.indexOf('\n', nl + 1)
        return setCursor(Math.min(nl + 1 + col, nextEnd < 0 ? value.length : nextEnd))
      }
      if (!input || key.meta) return
      const text = input.replace(/\r\n?/g, '\n')
      set(value.slice(0, at) + text + value.slice(at), at + text.length)
    },
    { isActive: focus },
  )

  const lines = value.split('\n')
  let pos = 0
  let cursorLine = 0
  for (const [i, l] of lines.entries()) {
    if (at <= pos + l.length) {
      cursorLine = i
      break
    }
    pos += l.length + 1
  }
  const first = Math.max(0, Math.min(cursorLine - maxRows + 1, lines.length - maxRows))
  const shown = lines.slice(first, first + maxRows)
  const col = at - (lines.slice(0, cursorLine).join('\n').length + (cursorLine ? 1 : 0))
  return (
    <Box flexDirection="column">
      {value === '' && placeholder ? (
        <Text dimColor>
          {focus ? '\x1b[7m \x1b[27m' : ''}
          {placeholder}
        </Text>
      ) : (
        shown.map((l, i) => {
          const li = first + i
          if (li !== cursorLine || !focus) return <Text key={li}>{l || ' '}</Text>
          const before = l.slice(0, col)
          const under = l.slice(col, col + 1) || ' '
          const after = l.slice(col + 1)
          return (
            <Text key={li}>
              {before}
              <Text inverse>{under}</Text>
              {after}
            </Text>
          )
        })
      )}
    </Box>
  )
}
