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

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const clip = (s: string, n = 100) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/**
 * One line that says what a call is for, as the web UI folds it: Claude's
 * Bash carries a `description`; file tools a path; search tools a
 * pattern; the rest fall through to the command or a compact input.
 */
export function toolSummary(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  if (str(i.description)) return str(i.description)
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return str(i.file_path) || str(i.path)
    case 'Glob':
    case 'Grep':
      return [str(i.pattern), str(i.path)].filter(Boolean).join(' in ')
    case 'WebFetch':
    case 'WebSearch':
      return str(i.url) || str(i.query)
    case 'Bash':
    case 'shell':
      return clip(str(i.command).replace(/\s+/g, ' '))
    case 'Task':
    case 'Agent':
      return str(i.description) || str(i.prompt)
    default: {
      const s = JSON.stringify(input)
      return s && s !== '{}' && s !== 'null' ? clip(s) : ''
    }
  }
}

type ToolUse = Extract<Item, { kind: 'tool_use' }>
type ToolResult = Extract<Item, { kind: 'tool_result' }>

/**
 * A tool call and its result as one folded line: what it was for and how
 * it went. Expanded, the command (or input) and the output follow.
 */
export function renderToolCall(
  s: StoredItem,
  call: ToolUse,
  result: ToolResult | null,
  expanded: boolean,
): string {
  const t = dim(clock(s.at))
  const status = !result
    ? color(33, 'running…')
    : result.isError
      ? color(31, 'error')
      : dim(result.output.length ? `${compact(result.output.length)} chars` : 'no output')
  const head = `${t} ${color(33, '⚙')} ${bold(call.name)} ${toolSummary(call.name, call.input)}  ${status}`
  if (!expanded) return head
  const i = (call.input ?? {}) as Record<string, unknown>
  const inputText = str(i.command) || JSON.stringify(call.input, null, 2)
  const body = [inputText, result ? result.output : ''].filter(Boolean).join('\n')
  return (
    head +
    '\n' +
    body
      .split('\n')
      .map((l) => '    ' + l)
      .join('\n')
  )
}

const compact = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n)

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
      return `${t} ${color(33, '⚙')} ${bold(it.name)} ${toolSummary(it.name, it.input)}`
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

/* oxlint-disable no-control-regex */
const ANSI = /\x1b\[[0-9;]*m/g
/** Whitespace at the start or end of a line, possibly behind or before a style code. */
const LEAD = /^((?:\x1b\[[0-9;]*m)*)\s+/
const TRAIL = /\s+((?:\x1b\[[0-9;]*m)*)$/
/* oxlint-enable no-control-regex */

/**
 * Wraps one rendered line to `width`, with a hanging indent for list
 * items: continuation lines of `* item`, `- item` or `1. item` line up
 * with the item's text rather than its marker.
 */
export function wrapLine(
  line: string,
  width: number,
  wrap: (s: string, w: number) => string,
): string[] {
  const plain = line.replace(ANSI, '')
  const marker = plain.match(/^(\s*)(?:[-*•]|\d+[.)])\s+/)
  const indent = marker ? marker[0].length : (plain.match(/^\s*/)?.[0].length ?? 0)
  // wrap-ansi leaves the spaces it broke at, sometimes behind a style code
  const tidy = (l: string) => l.replace(LEAD, '$1').replace(TRAIL, '$1')
  if (indent === 0 || indent >= width / 2)
    return wrap(line, width)
      .split('\n')
      .map((l, i) => (i === 0 ? l.replace(TRAIL, '$1') : tidy(l)))
  const [first, ...rest] = wrap(line, width - indent).split('\n')
  return [(first ?? '').replace(TRAIL, '$1'), ...rest.map((l) => ' '.repeat(indent) + tidy(l))]
}

/** Wraps rendered text (possibly many lines) to `width`, list items with a hanging indent. */
export function wrapText(
  text: string,
  width: number,
  wrap: (s: string, w: number) => string,
): string[] {
  return text.split('\n').flatMap((l) => wrapLine(l, width, wrap))
}
