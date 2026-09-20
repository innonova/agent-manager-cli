import { Api, ApiError } from './api.js'
import { loadSession, managerUrl } from './config.js'
import type { AgentRow, Project } from './types.js'

/**
 * A client from the saved login, or, inside an agent's session, from the
 * token the manager put in the environment (AGENT_MANAGER_TOKEN with
 * AGENT_MANAGER_URL), scoped to that agent's project.
 */
export function client(): Api {
  const token = process.env.AGENT_MANAGER_TOKEN
  if (token) return new Api(managerUrl(), null, token)
  const s = loadSession()
  if (!s) throw new Error('not logged in: run `am login`')
  return new Api(managerUrl(), s.cookie)
}

export async function findProject(api: Api, ref: string): Promise<Project> {
  const rows = await api.projects()
  const hit =
    rows.find((r) => r.project.id === ref) ??
    rows.find((r) => r.project.name === ref) ??
    rows.find((r) => r.project.name.toLowerCase() === ref.toLowerCase())
  if (!hit) throw new Error(`no project "${ref}" (am projects lists them)`)
  return hit.project
}

/**
 * An agent by id, by `project/agent`, or by a name unique across
 * projects. Names are what a person types; ids are what scripts keep.
 */
export async function findAgent(api: Api, ref: string): Promise<AgentRow> {
  const slash = ref.indexOf('/')
  if (slash > 0) {
    const project = await findProject(api, ref.slice(0, slash))
    const name = ref.slice(slash + 1)
    const row = (await api.agents(project.id)).find((r) => r.agent.name === name)
    if (!row) throw new Error(`no agent "${name}" in project "${project.name}"`)
    return row
  }
  try {
    const { agent, status } = await api.agent(ref)
    return { agent, status }
  } catch (e) {
    if (!(e instanceof ApiError) || (e.status !== 404 && e.status !== 403)) throw e
  }
  const matches: AgentRow[] = []
  for (const { project } of await api.projects()) {
    // an agent's token sees one project; the others answer 403 and are simply not where its agents are
    const rows = await api.agents(project.id).catch((e) => {
      if (e instanceof ApiError && e.status === 403) return []
      throw e
    })
    for (const row of rows) if (row.agent.name === ref) matches.push(row)
  }
  if (matches.length === 0)
    // archived agents are still addressable (to open, delete)
    for (const { project } of await api.projects()) {
      const rows = await api.agents(project.id, true).catch((e) => {
        if (e instanceof ApiError && e.status === 403) return []
        throw e
      })
      for (const row of rows) if (row.agent.name === ref) matches.push(row)
    }
  if (matches.length === 1) return matches[0]!
  if (matches.length === 0) throw new Error(`no agent "${ref}" (am agents <project> lists them)`)
  throw new Error(`"${ref}" names an agent in several projects; use project/agent`)
}
