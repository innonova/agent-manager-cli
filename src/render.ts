import { marked } from 'marked'
import { markedTerminal } from 'marked-terminal'
import type { Item, StoredItem } from './types.js'

marked.use(markedTerminal({ reflowText: false, tab: 2 }) as never)

const esc = (s: string) => s
export const dim = (s: string) => `\x1b[2m${s}\x1b[22m`
export const bold = (s: string) => `\x1b[1m${s}\x1b[22m`
export const color = (c: number, s: string) => `\x1b[${c}m${s}\x1b[39m`

export function markdown(text: string): string {
  try {
    return String(marked.parse(text, { async: false })).replace(/\n+$/, '')
  } catch {
    return text
  }
}

export function clock(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function oneLine(v: unknown, max = 100): string {
  const s = typeof v === 'string' ? v : (JSON.stringify(v) ?? '')
  const flat = s.replace(/\s+/g, ' ')
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

/** A tool call as one line: the name and its most telling argument. */
export function toolSummary(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  const arg =
    i.command ?? i.cmd ?? i.file_path ?? i.path ?? i.pattern ?? i.query ?? i.url ?? i.description
  return arg !== undefined ? `${name} ${oneLine(arg)}` : `${name} ${oneLine(input)}`
}

/**
 * Text for one transcript item, as the plain `tail` command prints it and
 * as the TUI's fallback. `full` expands tool results and thinking.
 */
export function renderItem(s: StoredItem, full = false): string {
  const t = dim(clock(s.at))
  const it: Item = s.item
  switch (it.kind) {
    case 'user':
      return `${t} ${color(36, bold(`${it.by ?? 'you'}:`))} ${it.text}`
    case 'text':
      return `${t} ${markdown(it.text)}${it.streaming ? dim(' ▍') : ''}`
    case 'thinking':
      return full ? `${t} ${dim(it.text)}` : `${t} ${dim('(thinking)')}`
    case 'tool_use':
      return `${t} ${color(33, '⚙ ' + toolSummary(it.name, it.input))}`
    case 'tool_result':
      return full
        ? `${t} ${it.isError ? color(31, 'tool error') : dim('tool result')}\n${it.output}`
        : `${t} ${it.isError ? color(31, '✗ tool error: ' + oneLine(it.output)) : dim('  → ' + oneLine(it.output))}`
    case 'permission': {
      const opts = it.options.map((o) => `${o.id}`).join(' / ')
      const status = it.decision ? `answered: ${it.decision}` : `waiting: ${opts}`
      return `${t} ${color(35, `? ${it.title || it.tool}`)} ${dim(status)}`
    }
    case 'error':
      return `${t} ${color(31, 'error: ' + it.message)}`
    case 'system':
      return `${t} ${dim('· ' + it.text)}`
    case 'turn_end': {
      const bits: string[] = []
      if (it.durationMs !== undefined) bits.push(`${Math.round(it.durationMs / 1000)}s`)
      if (it.costUsd !== undefined) bits.push(`$${it.costUsd.toFixed(3)}`)
      return `${t} ${dim('— turn end' + (bits.length ? ` (${bits.join(', ')})` : ''))}`
    }
    default:
      return `${t} ${esc(JSON.stringify(it))}`
  }
}

export function stateMark(state: string): string {
  switch (state) {
    case 'idle':
      return color(32, '●')
    case 'working':
      return color(34, '◐')
    case 'waiting-permission':
    case 'waiting-input':
      return color(35, '?')
    case 'error':
      return color(31, '✗')
    case 'starting':
      return color(33, '○')
    default:
      return dim('○')
  }
}
