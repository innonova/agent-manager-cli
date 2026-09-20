// Mirrors agent-manager's models; see ../agent-manager/docs/design.md.
export interface User {
  id: string
  name: string
}
export interface Repo {
  name: string
  path: string
}
/** One agent's work on one feature, as the manager's run log keeps it (see the manager's Runs section). */
export interface Run {
  id: string
  projectId: string
  projectName: string
  host: string
  repo: string
  slug: string
  agentId: string
  agentName: string
  profile: string
  model: string | null
  effort: string | null
  startedAt: number
  endedAt: number | null
  featureStatus: string | null
  outcome: string | null
  baseCommit: string | null
  endCommit: string | null
  turns: number | null
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  /** The reviewer's verdict, once given: accepted, or sent back with a cause (the model, the brief, or a missing doc fact). */
  review: {
    outcome: 'accepted' | 'sent-back'
    cause: 'model' | 'brief' | 'doc' | null
    note: string | null
    by: string
    at: number
  } | null
}

/** One entry of the install's learnings log: an observation with evidence, appended and never edited. */
export interface Learning {
  n: number
  at: number
  by: string
  ref: string | null
  text: string
}

export interface Project {
  id: string
  name: string
  path: string
  repos: Repo[]
  defaultProfile: string | null
  /** When agents in the project may start other agents. */
  delegation: 'free' | 'on-request'
  createdAt: number
  /** The machine it is on, when the manager is a hub. */
  host?: string
}
export type AgentState =
  'starting' | 'idle' | 'working' | 'waiting-input' | 'waiting-permission' | 'error' | 'exited'
export type AgentCounts = Record<AgentState, number>
export interface Agent {
  id: string
  projectId: string
  name: string
  profile: string
  cwd: string
  vendorConversationId: string | null
  currentSessionId: string | null
  createdAt: number
  archivedAt: number | null
  permissions: 'bypass' | 'ask'
  model: string | null
  effort: string | null
}
export interface AgentStatus {
  state: AgentState
  error: string | null
  lastActivityAt: number
  background: number
  model: string | null
  queued: number
  usage: {
    windows: { name: string; usedPercent: number; resetsAt: number | null }[]
    status?: 'ok' | 'warning' | 'rejected'
    context?: { used: number; size: number }
    spend?: { inputTokens: number; outputTokens: number; costUsd?: number; turns: number }
    /** The agent's spend across its sessions, once it has been restarted. */
    total?: { inputTokens: number; outputTokens: number; costUsd?: number; turns: number }
    provider?: string
    at: number
  } | null
}
export interface AgentRow {
  agent: Agent
  status: AgentStatus
}
export interface PermissionOption {
  id: string
  kind: 'allow' | 'allow-always' | 'deny'
  label: string
}
export interface TurnImage {
  mediaType: string
  data: string
}
export type Item =
  | { kind: 'user'; text: string; by?: string; images?: TurnImage[] }
  | { kind: 'text'; text: string; streaming: boolean }
  | { kind: 'thinking'; text: string }
  | {
      kind: 'permission'
      requestId: string
      tool: string
      title: string
      input: unknown
      options: PermissionOption[]
      decision: string | null
    }
  | { kind: 'tool_use'; id: string; name: string; input: unknown }
  | { kind: 'tool_result'; toolUseId: string; output: string; isError: boolean }
  | { kind: 'error'; message: string }
  | { kind: 'system'; text: string }
  | { kind: 'turn_end'; usage?: Record<string, unknown>; costUsd?: number; durationMs?: number }
export interface StoredItem {
  index: number
  sessionId: string
  at: number
  seqFrom: number
  seqTo: number
  item: Item
}
export interface Profile {
  name: string
  description?: string
  supported: boolean
}
export type FeatureStatus = 'planned' | 'in-progress' | 'review' | 'blocked' | 'done'
export interface Feature {
  slug: string
  repo: string
  path: string
  title: string
  status: FeatureStatus
  priority: number
  dependsOn: string[]
  body: string
  mtime: number
}
export interface PresenceUser {
  userId: string
  name: string
  typing: boolean
}
export type EventFrame =
  | {
      type: 'hello'
      user: string
      daemon: { connected: boolean }
      presence?: Record<string, PresenceUser[]>
    }
  | { type: 'daemon'; connected: boolean }
  | { type: 'project.counts'; projectId: string; counts: AgentCounts }
  | { type: 'agent.state'; agentId: string; projectId: string; status: AgentStatus }
  | { type: 'agent.item'; agentId: string; item: StoredItem }
  | { type: 'agent.reset'; agentId: string }
  | { type: 'feature.changed'; projectId: string; feature: Feature }
  | { type: 'presence'; agents: Record<string, PresenceUser[]> }
  | { type: string }
