import type { AgentStats } from './types.js'

/** A length of time as people say it: 6 d 14 h, 9 h 29 min, 12 min, 40 s. */
export function span(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const min = Math.round(s / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`
  const d = Math.floor(h / 24)
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`
}

/** A token count: 4.5k, 34M, 1.2B. */
export function count(n: number): string {
  const short = (v: number, unit: string) => `${v >= 100 ? Math.round(v) : v.toFixed(1)}${unit}`
  if (n >= 1e9) return short(n / 1e9, 'B')
  if (n >= 1e6) return short(n / 1e6, 'M')
  if (n >= 1e3) return short(n / 1e3, 'k')
  return String(n)
}

const day = (at: number): string =>
  new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const moment = (at: number): string =>
  `${day(at)} ${new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`

/** The statistics as rows of a label and what it says, in the words both the dialog and a terminal use. */
export function statRows(s: AgentStats): { label: string; text: string; note?: string }[] {
  if (s.since === null) return [{ label: 'runtime', text: 'this agent has not run yet' }]
  const t = s.tokens
  const by: [string, { turns: number; runtimeMs: number }][] = [
    ['a person', s.startedBy.person],
    ['itself', s.startedBy.self],
    ['the manager', s.startedBy.manager],
    ['another agent', s.startedBy.agent],
  ]
  const rows: { label: string; text: string; note?: string }[] = [
    {
      label: 'runtime',
      text: `${span(s.runtimeMs)} in ${s.turns.toLocaleString('en-US')} turn${s.turns === 1 ? '' : 's'}, since ${day(s.since)}${s.working ? '; working now' : ''}`,
      note: "the turns' lengths added up: waiting on a tool counts, sitting idle between turns does not",
    },
    {
      label: 'tokens',
      text: `${count(t.output)} out · ${count(t.input)} read fresh · ${count(t.cacheWrite)} written to cache · ${count(t.cacheRead)} read from cache`,
      note: 'every request of a turn reads the whole context again, from the cache: that figure is requests times context, not text',
    },
  ]
  if (s.costUsd > 0)
    rows.push({
      label: 'cost',
      text: `$${s.costUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
      note: "as the vendor prices the turns, at list prices; on a subscription it is the plan's quota that is spent",
    })
  rows.push({
    label: 'started by',
    text: by
      .filter(([, v]) => v.turns)
      .map(([who, v]) => `${who} ${v.turns.toLocaleString('en-US')} (${span(v.runtimeMs)})`)
      .join(' · '),
    note: 'itself: a background job finished and the agent took up the work again',
  })
  const m = s.sinceLastMessage
  if (m)
    rows.push({
      label: `since ${m.by}'s last direct message`,
      text: `${span(m.runtimeMs)} of work${m.turns > 1 ? ` in ${m.turns} turns` : ''}, ${count(m.outputTokens)} tokens out${s.working ? ' in the turns that have ended' : ''}; written ${moment(m.at)}`,
    })
  if (s.runs.count)
    rows.push({
      label: 'runs',
      text: `${s.runs.count.toLocaleString('en-US')} · median ${span(s.runs.medianMs)} · longest ${s.runs.longest
        .slice(0, 3)
        .map((r) => `${span(r.runtimeMs)} (${day(r.at)})`)
        .join(', ')}`,
      note: 'a run is the work between one direct message from a person and the next; what is said in the chat ends no run',
    })
  const u = s.unattended
  rows.push({
    label: 'unattended',
    text: u.runtimeMs
      ? `${span(u.runtimeMs)}, ${Math.round(u.share * 100)}% of the runtime${u.runs ? `; ${u.runs.toLocaleString('en-US')} runs went on unattended, median ${span(u.medianMs)}, longest ${span(u.longestMs)}` : ''}`
      : 'none',
    note: `work done more than ${span(u.afterMs)} after a person last wrote anything, in the flow or the chat: by then they have most likely turned to something else`,
  })
  return rows
}
