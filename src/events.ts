import { EventEmitter } from 'node:events'
import WebSocket from 'ws'
import type { EventFrame } from './types.js'

/**
 * The manager's event stream over its websocket, with the login cookie or an agent's token.
 * Reconnects with backoff until closed; `frame` for every frame, `open`
 * after each (re)connection, `close` when one drops.
 */
export class Events extends EventEmitter<{
  frame: [EventFrame]
  open: []
  close: []
  error: [Error]
}> {
  private ws: WebSocket | null = null
  private closed = false
  private attempt = 0
  private timer: NodeJS.Timeout | null = null
  /** What was last reported, resent on every (re)connection since the manager forgets a closed socket's. */
  private last: { agentId: string | null; typing: boolean } | null = null

  constructor(
    private readonly url: string,
    private readonly headers: Record<string, string>,
  ) {
    super()
  }

  connect(): void {
    if (this.closed) return
    const target = this.url.replace(/^http/, 'ws') + '/api/events'
    const ws = new WebSocket(target, { headers: this.headers })
    this.ws = ws
    ws.on('open', () => {
      this.attempt = 0
      if (this.last) ws.send(JSON.stringify({ type: 'presence', ...this.last }))
      this.emit('open')
    })
    ws.on('message', (data) => {
      try {
        this.emit('frame', JSON.parse(String(data)) as EventFrame)
      } catch {
        // not ours
      }
    })
    ws.on('error', (err) => this.emit('error', err))
    ws.on('close', (code) => {
      this.ws = null
      this.emit('close')
      if (this.closed) return
      if (code === 4401) {
        this.emit('error', new Error('not logged in (run: am login)'))
        return
      }
      const delay = Math.min(10_000, 500 * 2 ** this.attempt++)
      this.timer = setTimeout(() => this.connect(), delay)
    })
  }

  /** Presence: which agent this user is looking at and whether they are typing. */
  presence(agentId: string | null, typing = false): void {
    this.last = { agentId, typing }
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify({ type: 'presence', agentId, typing }))
  }

  close(): void {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.ws?.close()
  }

  /** Resolves with the first frame matching `pred`, or rejects after `ms`. */
  waitFor(pred: (f: EventFrame) => boolean, ms = 10_000): Promise<EventFrame> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off('frame', on)
        reject(new Error('timed out waiting for an event'))
      }, ms)
      const on = (f: EventFrame) => {
        if (!pred(f)) return
        clearTimeout(timer)
        this.off('frame', on)
        resolve(f)
      }
      this.on('frame', on)
    })
  }
}
