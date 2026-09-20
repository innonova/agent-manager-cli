import type {
  Agent,
  AgentRow,
  AgentStatus,
  Feature,
  Profile,
  Project,
  StoredItem,
  TurnImage,
  User,
} from './types.js'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

/** The manager's REST API with a cookie; the same calls the web UI makes. */
export class Api {
  constructor(
    readonly url: string,
    public cookie: string | null = null,
    /** An agent's own session token (AGENT_MANAGER_TOKEN) instead of a login. */
    readonly bearer: string | null = null,
  ) {}

  /** The credential as websocket headers. */
  authHeaders(): Record<string, string> {
    return this.bearer
      ? { authorization: `Bearer ${this.bearer}` }
      : this.cookie
        ? { cookie: this.cookie }
        : {}
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.url + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...this.authHeaders(),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) this.cookie = setCookie.split(';')[0] ?? null
    if (res.status === 204) return undefined as T
    const text = await res.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = { message: text }
    }
    if (!res.ok) {
      const d = data as { message?: string | string[]; code?: string } | null
      const msg = Array.isArray(d?.message) ? d.message.join('; ') : (d?.message ?? res.statusText)
      throw new ApiError(res.status, msg || `HTTP ${res.status}`, d?.code)
    }
    return data as T
  }

  login = (name: string, password: string) =>
    this.call<{ user: User }>('POST', '/api/auth/login', { name, password })
  logout = () => this.call<unknown>('POST', '/api/auth/logout', {})
  me = () => this.call<{ user: User }>('GET', '/api/auth/me')
  health = () => this.call<{ status: string; daemon: boolean }>('GET', '/api/health')

  projects = () =>
    this.call<{ project: Project; agentCounts: Record<string, number> }[]>('GET', '/api/projects')
  project = (id: string) => this.call<{ project: Project }>('GET', `/api/projects/${id}`)
  /** Repos are absolute paths on the manager's machine (or the named host's, on a hub). */
  createProject = (input: {
    name: string
    repos: { name?: string; path: string }[]
    defaultProfile?: string
    host?: string
  }) => this.call<{ project: Project }>('POST', '/api/projects', input)
  updateProject = (
    id: string,
    input: {
      name?: string
      repos?: { name?: string; path: string }[]
      defaultProfile?: string | null
    },
  ) => this.call<{ project: Project }>('PATCH', `/api/projects/${id}`, input)
  /** Stops and resumes the project's idle agents so they see changed settings; busy ones are skipped. */
  restartAgents = (projectId: string) =>
    this.call<{ restarted: string[]; skipped: { id: string; why: string }[] }>(
      'POST',
      `/api/projects/${projectId}/agents/restart`,
      {},
    )
  agents = (projectId: string, archived = false) =>
    this.call<AgentRow[]>(
      'GET',
      `/api/projects/${projectId}/agents${archived ? '?archived=1' : ''}`,
    )
  agent = (id: string) =>
    this.call<{ agent: Agent; status: AgentStatus; sessions: unknown[] }>(
      'GET',
      `/api/agents/${id}`,
    )
  createAgent = (
    projectId: string,
    input: {
      name: string
      profile?: string
      cwd?: string
      permissions?: 'bypass' | 'ask'
      model?: string
      effort?: string
    },
  ) => this.call<AgentRow>('POST', `/api/projects/${projectId}/agents`, input)
  items = (
    id: string,
    query: { from?: number; tail?: number; before?: number; limit?: number },
  ) => {
    const q = Object.entries(query)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join('&')
    return this.call<{ items: StoredItem[]; total: number }>('GET', `/api/agents/${id}/items?${q}`)
  }
  /** `steer`: while a turn runs, the message goes into it (or is queued) instead of being refused. */
  turn = (id: string, text: string, steer = false, images: TurnImage[] = []) =>
    this.call<{ ok: true; mode: 'sent' | 'steered' | 'queued' }>('POST', `/api/agents/${id}/turn`, {
      text,
      ...(steer ? { steer: true } : {}),
      ...(images.length ? { images } : {}),
    })
  decide = (id: string, requestId: string, option: string) =>
    this.call<{ ok: true }>('POST', `/api/agents/${id}/permission`, { requestId, option })
  interrupt = (id: string) => this.call<{ ok: true }>('POST', `/api/agents/${id}/interrupt`, {})
  stop = (id: string) => this.call<{ ok: true }>('POST', `/api/agents/${id}/stop`, {})
  /** Stops and resumes one agent with the current settings; the manager refuses (409) while it is busy. */
  restart = (id: string) => this.call<{ ok: true }>('POST', `/api/agents/${id}/restart`, {})
  archive = (id: string) => this.call<{ ok: true }>('POST', `/api/agents/${id}/archive`, {})
  /** Forgets the agent for good: process, daemon logs, cache and rows. */
  remove = (id: string) => this.call<{ ok: true }>('DELETE', `/api/agents/${id}`)
  profiles = () => this.call<{ profiles: Profile[] }>('GET', '/api/profiles')

  features = (projectId: string) =>
    this.call<{ features: Feature[] }>('GET', `/api/projects/${projectId}/features`)
  feature = (projectId: string, slug: string) =>
    this.call<{ feature: Feature }>('GET', `/api/projects/${projectId}/features/${slug}`)
  respond = (projectId: string, slug: string, text: string, status?: string) =>
    this.call<{ feature: Feature }>('POST', `/api/projects/${projectId}/features/${slug}/respond`, {
      text,
      ...(status ? { status } : {}),
    })
  setFeatureStatus = (projectId: string, slug: string, status: string) =>
    this.call<{ feature: Feature }>('PATCH', `/api/projects/${projectId}/features/${slug}`, {
      status,
    })
}
