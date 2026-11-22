// Mirrors agent-manager's models; see ../agent-manager/docs/design.md.
export interface User {
  id: string
  name: string
}
export interface Repo {
  name: string
  path: string
  /** A stream's own folder in the store, standing where a repository stands. */
  folder?: true
}
/** A repository a stream can clone, as the manager's registry has it. */
export interface Repository {
  name: string
  source: string
  setup: string | null
  /** The untracked files copied into a fresh clone. */
  seed: string[]
  /** The streams that have a clone of it. */
  usedBy: string[]
}
/** A clone in a stream's home, and how far the making of it is. */
export interface Clone {
  name: string
  path: string
  state: 'cloning' | 'setting up' | 'ready' | 'failed'
  branch: string | null
  message: string | null
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
  /** A list of repositories, or a stream: a unit of work with a home of its own that clones what it needs. */
  kind?: 'project' | 'stream'
  /** The primary repository, or a stream's home. */
  path: string
  repos: Repo[]
  defaultProfile: string | null
  /** When agents in the project may start other agents. */
  delegation: 'free' | 'on-request'
  createdAt: number
  /** The machine it is on, when the manager is a hub. */
  host?: string
  /** How a person's machine reaches that one over SSH, for opening the project in an editor. */
  sshHost?: string
  /** The VS Code workspace file the manager keeps beside the repositories. */
  workspace?: string
}
export type AgentState =
  'starting' | 'idle' | 'working' | 'waiting-input' | 'waiting-permission' | 'error' | 'exited'
export type AgentCounts = Record<AgentState, number>
export interface Agent {
  id: string
  projectId: string
  name: string
  profile: string
  /** The machine its sessions run on: null for the project's own, else a spoke's name. */
  host?: string | null
  cwd: string
  vendorConversationId: string | null
  currentSessionId: string | null
  createdAt: number
  archivedAt: number | null
  permissions: 'bypass' | 'ask'
  /** When it stops, the manager asks it whether it can go on. */
  nudge?: boolean
  model: string | null
  effort: string | null
}
export interface AgentStatus {
  state: AgentState
  error: string | null
  lastActivityAt: number
  background: number
  /** Until when the agent said its background wait is expected; the manager's poke waits for it. */
  holdUntil?: number | null
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

/** A small actionable item about the project: one file under `notes/` in the primary repository. */
export interface NoteItem {
  id: string
  done: boolean
  date: string
  title: string
  body: string
}
export interface Notes {
  dir: string
  items: NoteItem[]
  open: number
}

/** One message of an agent's chat with the people (see the manager's Chat section). */
export interface ChatMessage {
  id: number
  agentId: string
  from: 'agent' | 'person'
  author: string
  kind: 'message' | 'decision' | 'question'
  important: boolean
  text: string
  /** The message this one replies to. */
  re: { id: number; kind: string; excerpt: string } | null
  /** How a person's message travelled: beside the work, as a turn, as a steer. */
  via: 'aside' | 'turn' | 'steer' | null
  images: number
  at: number
  /** A person's message: when the agent got it. */
  readAt: number | null
  /** A question: when it stopped being open, and how. */
  closedAt: number | null
  closedBy: 'answer' | 'person' | 'agent' | null
}
export interface ChatSummary {
  unread: number
  questions: number
  last: number
}

/** One exchange of an agent's dialog as a list shows it. */
export interface ExchangeLine {
  n: number
  at: number
  by: string
  tokens: number
  /** What it settled or asked, in the classifier's words; the first words of the message until weighed. */
  line: string
  kind: 'purpose' | 'rule' | 'decision' | 'task' | 'chatter' | null
  weight: number | null
  inForce: boolean | null
  supersededBy: number | null
  withdrawn: boolean
}
/** One exchange, word for word: what the person wrote, and what the agent wrote back. */
export interface Exchange {
  n: number
  at: number
  by: string
  person: string
  agent: string
  withdrawn: boolean
}

/** How an agent has been run, read off its transcript; see agent-manager's design, "Statistics". */
export interface AgentStats {
  since: number | null
  turns: number
  runtimeMs: number
  tokens: { input: number; cacheWrite: number; cacheRead: number; output: number }
  costUsd: number
  working: boolean
  startedBy: Record<'person' | 'agent' | 'manager' | 'self', { turns: number; runtimeMs: number }>
  sinceLastMessage: {
    at: number
    by: string
    runtimeMs: number
    turns: number
    outputTokens: number
  } | null
  runs: {
    count: number
    medianMs: number
    longestMs: number
    longest: { at: number; by: string; runtimeMs: number }[]
  }
  unattended: {
    afterMs: number
    runtimeMs: number
    share: number
    runs: number
    longestMs: number
    medianMs: number
  }
}
