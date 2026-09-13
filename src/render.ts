import { marked } from 'marked'
import { markedTerminal } from 'marked-terminal'
import type { Item, StoredItem } from './types.js'

marked.use(markedTerminal({ reflowText: false, tab: 2 }) as never)

/* oxlint-disable no-control-regex */
/**
 * Everything a terminal would act on except colours and styles: control
 * characters (not newline and tab), C1 controls (`\x9b` opens a CSI on
 * its own), CSI with any parameter and intermediate bytes, OSC, DCS/APC/PM/SOS
 * strings, two-byte escapes, and a stray ESC. Applied until nothing changes,
 * so a sequence assembled by an earlier removal (`ESC [ NUL 2 J`) goes too.
 */
const CONTROLS = /[\x00-\x08\x0b-\x1a\x1c-\x1f\x7f-\x9f]/g
const SEQUENCE =
  /\x1b(?:\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[P_^X][^\x1b]*(?:\x1b\\)?|[\x20-\x2f]*[\x30-\x7e]|$)/g
const SGR = /^\x1b\[[0-9;]*m$/
const SGR_ALL = /\x1b\[([0-9;]*)m/g
/* oxlint-enable no-control-regex */

/** Keeps colours and styles, drops every other escape sequence and control character. */
export function esc(s: string): string {
  let out = s
  for (let pass = 0; pass < 4; pass++) {
    // sequences first: a BEL or ST still terminates the OSC it belongs to
    const next = out.replace(SEQUENCE, (m) => (SGR.test(m) ? m : '')).replace(CONTROLS, '')
    if (next === out) return out
    out = next
  }
  // oxlint-disable-next-line no-control-regex
  return out.replace(/\x1b/g, '') // whatever is left after four passes is not worth keeping
}

/**
 * Splits rendered text into lines, re-opening on each line the styles
 * still active from the previous one, since each line is drawn as its own
 * terminal node. A reset (`ESC[0m`, `ESC[m`) closes everything.
 */
export function splitStyled(text: string): string[] {
  const lines = text.split('\n')
  const out: string[] = []
  let active: string[] = []
  for (const line of lines) {
    out.push(active.join('') + line)
    for (const m of line.matchAll(SGR_ALL)) {
      const codes = (m[1] ?? '').split(';').filter((c) => c !== '')
      if (codes.length === 0 || codes.includes('0')) active = []
      else active.push(m[0])
      if (active.length > 16) active = active.slice(-16)
    }
  }
  return out
}

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
  const head = `${t} ${color(33, '⚙')} ${bold(esc(call.name))} ${esc(toolSummary(call.name, call.input))}  ${status}`
  if (!expanded) return head
  const i = (call.input ?? {}) as Record<string, unknown>
  const inputText = str(i.command) || JSON.stringify(call.input, null, 2)
  const body = [inputText, result ? result.output : ''].filter(Boolean).map(esc).join('\n')
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
    case 'user': {
      const imgs = it.images?.length
        ? ' ' +
          dim(
            it.images
              .map(
                (i) =>
                  `[image ${i.mediaType.split('/')[1]} ${compact(Math.floor((i.data.length * 3) / 4))} B]`,
              )
              .join(' '),
          )
        : ''
      return `${t} ${color(36, bold(`${esc(it.by ?? 'you')}:`))} ${esc(it.text)}${imgs}`
    }
    case 'text':
      return `${t} ${markdown(esc(it.text))}${it.streaming ? dim(' ▍') : ''}`
    case 'thinking':
      return full ? `${t} ${dim(esc(it.text))}` : `${t} ${dim('(thinking)')}`
    case 'tool_use':
      return `${t} ${color(33, '⚙')} ${bold(esc(it.name))} ${esc(toolSummary(it.name, it.input))}`
    case 'tool_result':
      return full
        ? `${t} ${it.isError ? color(31, 'tool error') : dim('tool result')}\n${esc(it.output)}`
        : `${t} ${it.isError ? color(31, '✗ tool error: ' + oneLine(esc(it.output))) : dim('  → ' + oneLine(esc(it.output)))}`
    case 'permission': {
      const opts = it.options.map((o) => esc(o.id)).join(' / ')
      const status = it.decision ? `answered: ${esc(it.decision)}` : `waiting: ${opts}`
      return `${t} ${color(35, `? ${esc(it.title || it.tool)}`)} ${dim(status)}`
    }
    case 'error':
      return `${t} ${color(31, 'error: ' + esc(it.message))}`
    case 'system':
      return `${t} ${dim('· ' + esc(it.text))}`
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
  return splitStyled(text).flatMap((l) => wrapLine(l, width, wrap))
}
