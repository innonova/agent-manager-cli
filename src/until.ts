/**
 * When a hold ends, from what a person or an agent types: `off` (clear),
 * a clock time `13:30` (today, or tomorrow if that has passed), or a
 * duration `45m`, `2h`, `1d`. Returns unix ms, or null for `off`.
 */
export function parseUntil(text: string, now = Date.now()): number | null {
  const t = text.trim().toLowerCase()
  if (t === 'off' || t === 'none' || t === 'clear') return null
  const dur = /^(\d+(?:\.\d+)?)\s*(m|min|h|hr|d)$/.exec(t)
  if (dur) {
    const n = Number(dur[1])
    const unit = dur[2]!.startsWith('m') ? 60_000 : dur[2]!.startsWith('h') ? 3_600_000 : 86_400_000
    return now + Math.round(n * unit)
  }
  const clock = /^(\d{1,2}):(\d{2})$/.exec(t)
  if (clock) {
    const h = Number(clock[1])
    const m = Number(clock[2])
    if (h > 23 || m > 59) throw new Error(`not a time of day: ${text}`)
    const d = new Date(now)
    d.setHours(h, m, 0, 0)
    if (d.getTime() <= now) d.setDate(d.getDate() + 1)
    return d.getTime()
  }
  throw new Error(
    `until what? a time like 13:30, a duration like 45m or 2h, or off (not "${text}")`,
  )
}

export const holdText = (until: number | null): string =>
  until === null
    ? 'hold cleared'
    : `holding until ${new Date(until).toLocaleString([], { hour: '2-digit', minute: '2-digit', weekday: new Date(until).getDate() === new Date().getDate() ? undefined : 'short' })}`
