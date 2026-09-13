import { EventEmitter } from 'node:events'
import type { Api } from '../api.js'
import type { Events } from '../events.js'
import type {
  AgentCounts,
  AgentRow,
  EventFrame,
  Feature,
  PresenceUser,
  Profile,
  Project,
  StoredItem,
} from '../types.js'

export const PAGE = 200

export interface Transcript {
  /** Index-keyed, as long as the history; holes below `earliest` are pages not loaded. */
  items: (StoredItem | undefined)[]
  earliest: number
  loading: boolean
}

/** What the store needs from the API and the event stream; stubbed in tests. */
export type ApiLike = Pick<
  Api,
  | 'projects'
  | 'agents'
  | 'agent'
  | 'items'
  | 'turn'
  | 'decide'
  | 'interrupt'
  | 'stop'
  | 'createAgent'
  | 'profiles'
  | 'features'
  | 'feature'
  | 'respond'
>
export type EventsLike = Pick<Events, 'on' | 'off' | 'connect' | 'close' | 'presence'>

/**
 * Everything the TUI shows, kept current from the event stream. Components
 * subscribe to `change` and read the fields; nothing here knows about Ink.
 */
export class Store extends EventEmitter<{ change: [] }> {
  version = 0
  user = ''
  connected = false
  daemon = true
  projects: { project: Project; agentCounts: Partial<AgentCounts> }[] = []
  agents = new Map<string, AgentRow[]>()
  byId = new Map<string, AgentRow>()
  transcripts = new Map<string, Transcript>()
  presence: Record<string, PresenceUser[]> = {}
  profiles: Profile[] = []
  features = new Map<string, Feature[]>()
  /** Agents that finished or asked while not shown. */
  attention = new Set<string>()
  /** The agent on screen, for presence and attention. */
  current: string | null = null
  /** A one-line message for the footer, cleared by the next one. */
  notice: string | null = null
  /** Composer text per agent, kept while the screen is elsewhere. */
  drafts = new Map<string, string>()
  /** Rings the terminal bell; replaced in tests. */
  bell: () => void = () => process.stdout.write('\x07')

  constructor(
    readonly api: ApiLike,
    readonly events: EventsLike,
  ) {
    super()
    events.on('frame', (f) => this.onFrame(f))
    events.on('open', () => {
      this.connected = true
      void this.refresh()
    })
    events.on('close', () => {
      this.connected = false
      this.changed()
    })
    events.on('error', (e) => this.say(e.message))
  }

  start(): void {
    this.events.connect()
    void this.loadProjects()
  }

  changed(): void {
    this.version++
    this.emit('change')
  }

  say(text: string): void {
    this.notice = text
    this.changed()
  }

  private async guard<T>(p: Promise<T>): Promise<T | undefined> {
    try {
      return await p
    } catch (e) {
      this.say(e instanceof Error ? e.message : String(e))
      return undefined
    }
  }

  async loadProjects(): Promise<void> {
    const rows = await this.guard(this.api.projects())
    if (!rows) return
    this.projects = rows
    this.changed()
  }

  async loadAgents(projectId: string): Promise<void> {
    const rows = await this.guard(this.api.agents(projectId))
    if (!rows) return
    this.agents.set(projectId, rows)
    for (const r of rows) this.byId.set(r.agent.id, r)
    this.changed()
  }

  async loadProfiles(): Promise<void> {
    const r = await this.guard(this.api.profiles())
    if (!r) return
    this.profiles = r.profiles.filter((p) => p.supported)
    this.changed()
  }

  /** Shows an agent: loads the tail once, reports presence, clears its attention mark. */
  async open(agentId: string | null): Promise<void> {
    this.current = agentId
    this.events.presence(agentId, false)
    if (!agentId) return this.changed()
    this.attention.delete(agentId)
    if (!this.byId.has(agentId)) {
      const r = await this.guard(this.api.agent(agentId))
      if (r) this.byId.set(agentId, { agent: r.agent, status: r.status })
    }
    this.changed()
    if (!this.transcripts.has(agentId)) await this.loadTail(agentId)
  }

  private async loadTail(agentId: string): Promise<void> {
    const r = await this.guard(this.api.items(agentId, { tail: PAGE }))
    if (!r) return
    const items: (StoredItem | undefined)[] = []
    items.length = r.total
    for (const it of r.items) items[it.index] = it
    this.transcripts.set(agentId, { items, earliest: r.items[0]?.index ?? 0, loading: false })
    this.changed()
  }

  /**
   * Items at and after the transcript's end, after a gap; after a
   * reconnect also the last few again, since updates to them (a stream
   * ending, a permission answered) were missed with the socket.
   */
  private async loadFrom(agentId: string, overlap = 0): Promise<void> {
    const t = this.transcripts.get(agentId)
    if (!t) return
    const from = Math.max(0, t.items.length - overlap)
    const r = await this.guard(this.api.items(agentId, { from }))
    if (!r) return
    if (r.total < t.items.length || (r.items[0]?.index ?? from) > t.items.length)
      return this.loadTail(agentId) // renumbered: start over
    if (r.total > t.items.length) t.items.length = r.total
    for (const it of r.items) t.items[it.index] = it
    this.changed()
  }

  hasEarlier(agentId: string): boolean {
    const t = this.transcripts.get(agentId)
    return !!t && t.earliest > 0
  }

  async loadEarlier(agentId: string): Promise<void> {
    const t = this.transcripts.get(agentId)
    if (!t || t.loading || t.earliest <= 0) return
    t.loading = true
    this.changed()
    const r = await this.guard(this.api.items(agentId, { before: t.earliest, limit: PAGE }))
    t.loading = false
    if (r) {
      for (const it of r.items) t.items[it.index] = it
      t.earliest = r.items[0]?.index ?? 0
    }
    this.changed()
  }

  /** The oldest unanswered permission of the turn under way, if any. */
  pending(agentId: string): StoredItem | null {
    const t = this.transcripts.get(agentId)
    if (!t) return null
    let found: StoredItem | null = null
    for (let i = t.items.length - 1; i >= 0 && i >= t.items.length - 200; i--) {
      const s = t.items[i]
      if (s?.item.kind === 'turn_end') break
      if (s?.item.kind === 'permission' && !s.item.decision) found = s
    }
    return found
  }

  turn = (agentId: string, text: string, steer = false) =>
    this.guard(this.api.turn(agentId, text, steer))
  decide = (agentId: string, requestId: string, option: string) =>
    this.guard(this.api.decide(agentId, requestId, option))
  interrupt = (agentId: string) => this.guard(this.api.interrupt(agentId))
  stop = (agentId: string) => this.guard(this.api.stop(agentId))
  typing = (agentId: string) => this.events.presence(agentId, true)

  async createAgent(
    projectId: string,
    input: { name: string; profile?: string; permissions?: 'bypass' | 'ask' },
  ): Promise<AgentRow | undefined> {
    const row = await this.guard(this.api.createAgent(projectId, input))
    if (!row) return undefined
    this.byId.set(row.agent.id, row)
    this.agents.set(projectId, [...(this.agents.get(projectId) ?? []), row])
    this.changed()
    return row
  }

  async loadFeatures(projectId: string): Promise<void> {
    const r = await this.guard(this.api.features(projectId))
    if (!r) return
    this.features.set(projectId, r.features)
    this.changed()
  }

  respond = (projectId: string, slug: string, text: string, status?: string) =>
    this.guard(this.api.respond(projectId, slug, text, status))

  private async refresh(): Promise<void> {
    await this.loadProjects()
    for (const pid of this.agents.keys()) await this.loadAgents(pid)
    for (const aid of this.transcripts.keys()) await this.loadFrom(aid, 20)
    this.changed()
  }

  private onFrame(f: EventFrame): void {
    switch (f.type) {
      case 'hello': {
        const h = f as Extract<EventFrame, { type: 'hello' }>
        this.user = h.user
        this.daemon = h.daemon.connected
        if (h.presence) this.presence = h.presence
        break
      }
      case 'daemon':
        this.daemon = (f as { connected: boolean }).connected
        break
      case 'presence':
        this.presence = (f as { agents: Record<string, PresenceUser[]> }).agents
        break
      case 'project.counts': {
        const { projectId, counts } = f as { projectId: string; counts: AgentCounts }
        const row = this.projects.find((p) => p.project.id === projectId)
        if (row) row.agentCounts = counts
        break
      }
      case 'agent.state': {
        const { agentId, status } = f as Extract<EventFrame, { type: 'agent.state' }>
        const row = this.byId.get(agentId)
        if (!row) break
        const was = row.status.state
        row.status = status
        if (agentId !== this.current) {
          if (was === 'working' && status.state === 'idle' && !status.background) {
            this.attention.add(agentId)
            this.bell()
          }
          if (status.state === 'waiting-permission' && was !== 'waiting-permission') {
            this.attention.add(agentId)
            this.bell()
          }
        } else if (status.state === 'waiting-permission' && was !== 'waiting-permission')
          this.bell()
        break
      }
      case 'agent.item': {
        const { agentId, item } = f as Extract<EventFrame, { type: 'agent.item' }>
        const t = this.transcripts.get(agentId)
        if (!t) break
        if (item.index < t.items.length) t.items[item.index] = item
        else if (item.index === t.items.length) t.items.push(item)
        else void this.loadFrom(agentId)
        break
      }
      case 'agent.reset': {
        const { agentId } = f as { agentId: string }
        if (this.transcripts.has(agentId)) void this.loadTail(agentId)
        break
      }
      case 'feature.changed': {
        const { projectId, feature } = f as Extract<EventFrame, { type: 'feature.changed' }>
        const list = this.features.get(projectId)
        if (!list) break
        const i = list.findIndex((x) => x.slug === feature.slug)
        if (i >= 0) list[i] = feature
        else list.push(feature)
        break
      }
      default:
        return
    }
    this.changed()
  }
}
