import { parseArgs } from 'node:util'
import readline from 'node:readline'
import { Api, ApiError } from './api.js'
import { clearSession, loadSession, managerUrl, saveSession } from './config.js'
import { client, findAgent, findProject } from './client.js'
import { Events } from './events.js'
import { bold, dim, renderItem, stateMark } from './render.js'
import type { Agent, EventFrame, StoredItem } from './types.js'

export interface Io {
  out: (line: string) => void
  err: (line: string) => void
  /** Reads a line from the user; `hidden` for passwords. */
  ask: (prompt: string, hidden?: boolean) => Promise<string>
}

export const USAGE = `am — terminal client for agent-manager

  am                          open the TUI
  am login [--name NAME] [--url URL]
  am logout
  am projects
  am agents <project>
  am new <project> <name> [--profile P] [--ask] [--cwd REPO] [--model M] [--effort E]
  am tail <agent> [--lines N] [--follow] [--full]
  am turn <agent> <text...>   send a turn and print it as it runs (--no-wait: just send)
  am allow <agent> [--option ID]   answer the pending permission (first allow option by default)
  am deny <agent>             both print the rest of the turn unless --no-wait
  am interrupt <agent>
  am stop <agent>
  am features <project>
  am feature <project> <slug>
  am respond <project> <slug> <text...> [--status planned|review|blocked|done]

An agent is an id, project/name, or a name unique across projects.
The manager is ${'AGENT_MANAGER_URL'} or the one logged into (default http://127.0.0.1:4268).`

function stdIo(): Io {
  return {
    out: (l) => process.stdout.write(l + '\n'),
    err: (l) => process.stderr.write(l + '\n'),
    ask: (prompt, hidden = false) =>
      new Promise((resolve) => {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
          terminal: true,
        })
        if (hidden) {
          // echo nothing while the password is typed
          const mute = rl as unknown as { _writeToOutput: (s: string) => void }
          const orig = mute._writeToOutput.bind(rl)
          mute._writeToOutput = (s: string) => {
            if (s.startsWith(prompt)) orig(prompt)
            else if (s.includes('\n')) orig('\n')
          }
        }
        rl.question(prompt, (a) => {
          rl.close()
          resolve(a)
        })
      }),
  }
}

/** Runs one plain command; returns the exit code. Throws nothing: errors go to `io.err`. */
export async function run(argv: string[], io: Io = stdIo()): Promise<number> {
  const [cmd, ...rest] = argv
  try {
    switch (cmd) {
      case undefined:
      case 'tui':
        return await (await import('./tui/index.js')).tui(io)
      case 'help':
      case '--help':
      case '-h':
        io.out(USAGE)
        return 0
      case 'login':
        return await login(rest, io)
      case 'logout': {
        const api = client()
        await api.logout().catch(() => undefined)
        clearSession()
        io.out('logged out')
        return 0
      }
      case 'projects': {
        const api = client()
        for (const { project, agentCounts } of await api.projects()) {
          const counts = Object.entries(agentCounts)
            .filter(([, n]) => n > 0)
            .map(([s, n]) => `${n} ${s}`)
            .join(', ')
          io.out(`${bold(project.name)}  ${dim(project.id)}  ${counts ? dim(counts) : ''}`)
          for (const r of project.repos) io.out(`  ${r.name}  ${dim(r.path)}`)
        }
        return 0
      }
      case 'agents': {
        const api = client()
        const project = await findProject(api, need(rest[0], 'project'))
        for (const { agent, status } of await api.agents(project.id)) {
          const extra = [
            status.model,
            status.background ? `${status.background} bg` : '',
            status.error,
          ]
            .filter(Boolean)
            .join(', ')
          io.out(
            `${stateMark(status.state)} ${bold(agent.name)}  ${status.state}  ${dim(agent.id)}  ${dim(extra)}`,
          )
        }
        return 0
      }
      case 'new': {
        const { values, positionals } = parseArgs({
          args: rest,
          allowPositionals: true,
          options: {
            profile: { type: 'string' },
            ask: { type: 'boolean' },
            cwd: { type: 'string' },
            model: { type: 'string' },
            effort: { type: 'string' },
          },
        })
        const api = client()
        const project = await findProject(api, need(positionals[0], 'project'))
        const name = need(positionals[1], 'name')
        const { agent, status } = await api.createAgent(project.id, {
          name,
          ...(values.profile ? { profile: values.profile } : {}),
          ...(values.ask ? { permissions: 'ask' as const } : {}),
          ...(values.cwd ? { cwd: values.cwd } : {}),
          ...(values.model ? { model: values.model } : {}),
          ...(values.effort ? { effort: values.effort } : {}),
        })
        io.out(`${stateMark(status.state)} ${bold(agent.name)}  ${dim(agent.id)}  ${agent.profile}`)
        return 0
      }
      case 'tail':
        return await tail(rest, io)
      case 'turn':
        return await turn(rest, io)
      case 'allow':
      case 'deny':
        return await decide(cmd, rest, io)
      case 'interrupt': {
        const api = client()
        const { agent } = await findAgent(api, need(rest[0], 'agent'))
        await api.interrupt(agent.id)
        io.out('interrupt sent')
        return 0
      }
      case 'stop': {
        const api = client()
        const { agent } = await findAgent(api, need(rest[0], 'agent'))
        await api.stop(agent.id)
        io.out('stopped')
        return 0
      }
      case 'features': {
        const api = client()
        const project = await findProject(api, need(rest[0], 'project'))
        for (const f of (await api.features(project.id)).features)
          io.out(
            `${f.status.padEnd(11)} ${bold(f.slug)}  ${f.title}  ${dim(`${f.repo}, p${f.priority}`)}`,
          )
        return 0
      }
      case 'feature': {
        const api = client()
        const project = await findProject(api, need(rest[0], 'project'))
        const { feature } = await api.feature(project.id, need(rest[1], 'slug'))
        io.out(`${bold(feature.title)}  ${dim(`${feature.status}, ${feature.path}`)}`)
        io.out('')
        io.out((await import('./render.js')).markdown(feature.body))
        return 0
      }
      case 'respond': {
        const { values, positionals } = parseArgs({
          args: rest,
          allowPositionals: true,
          options: { status: { type: 'string' } },
        })
        const api = client()
        const project = await findProject(api, need(positionals[0], 'project'))
        const slug = need(positionals[1], 'slug')
        const text = positionals.slice(2).join(' ')
        if (!text) throw new Error('a response text is required')
        const { feature } = await api.respond(project.id, slug, text, values.status)
        io.out(`${feature.slug}: ${feature.status}`)
        return 0
      }
      default:
        io.err(`unknown command "${cmd}"\n\n${USAGE}`)
        return 2
    }
  } catch (e) {
    io.err(
      e instanceof ApiError
        ? `${e.message} (${e.status})`
        : e instanceof Error
          ? e.message
          : String(e),
    )
    return 1
  }
}

function need(v: string | undefined, what: string): string {
  if (!v) throw new Error(`${what} is required`)
  return v
}

async function login(rest: string[], io: Io): Promise<number> {
  const { values } = parseArgs({
    args: rest,
    options: { name: { type: 'string' }, url: { type: 'string' }, password: { type: 'string' } },
  })
  const url = (
    values.url ??
    process.env.AGENT_MANAGER_URL ??
    loadSession()?.url ??
    managerUrl()
  ).replace(/\/$/, '')
  const name = values.name ?? (await io.ask('user: '))
  const password = values.password ?? (await io.ask('password: ', true))
  const api = new Api(url)
  const { user } = await api.login(name.trim(), password)
  if (!api.cookie) throw new Error('the manager set no session cookie')
  saveSession({ url, cookie: api.cookie, user: user.name })
  io.out(`logged in to ${url} as ${user.name}`)
  return 0
}

async function tail(rest: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      lines: { type: 'string', default: '40' },
      follow: { type: 'boolean', short: 'f' },
      full: { type: 'boolean' },
    },
  })
  const api = client()
  const { agent } = await findAgent(api, need(positionals[0], 'agent'))
  const n = Number(values.lines)
  if (!Number.isInteger(n) || n < 0) throw new Error('--lines must be a non-negative integer')
  const { items, total } = await api.items(agent.id, { tail: n })
  const shown = new Map<number, string>()
  const print = (s: StoredItem) => {
    const line = renderItem(s, values.full)
    if (shown.get(s.index) === line) return
    shown.set(s.index, line)
    io.out(line)
  }
  for (const s of items) print(s)
  if (!values.follow) return 0
  const events = new Events(api.url, api.cookie!)
  let next = total
  await new Promise<void>((resolve, reject) => {
    events.on('error', (e) => {
      io.err(e.message)
      if (/not logged in/.test(e.message)) resolve()
    })
    events.on('frame', (f: EventFrame) => {
      if (f.type === 'agent.item' && 'agentId' in f && f.agentId === agent.id) {
        const s = (f as { item: StoredItem }).item
        // an update to an earlier item replaces it in place in the TUI; here it is reprinted
        if (s.index >= next) next = s.index + 1
        if (s.item.kind === 'text' && s.item.streaming) return // print text once it is complete
        print(s)
      }
      if (f.type === 'agent.reset') {
        io.out(dim('· transcript rebuilt by the manager'))
      }
    })
    events.connect()
    process.on('SIGINT', () => {
      events.close()
      resolve()
    })
    void reject
  })
  return 0
}

/**
 * Prints the items of the turn under way as they arrive, until it ends,
 * errors or stops to ask a permission. `total` is the index the turn's
 * items start at.
 */
async function follow(api: Api, agent: Agent, total: number, io: Io): Promise<void> {
  const events = new Events(api.url, api.cookie!)
  events.on('error', (e) => io.err(e.message))
  events.connect()
  await new Promise<void>((r) => events.once('open', r))
  // anything that landed between the caller's snapshot and the socket opening
  const missed = await api.items(agent.id, { from: total })
  let last = total - 1
  const consider = (s: StoredItem): boolean => {
    if (s.index <= last && !(s.item.kind === 'text' && !s.item.streaming)) return false
    if (s.item.kind === 'text' && s.item.streaming) return false // print text once it is complete
    last = Math.max(last, s.index)
    io.out(renderItem(s))
    if (s.item.kind === 'turn_end' || s.item.kind === 'error') return true
    if (s.item.kind === 'permission' && !s.item.decision) {
      io.out(dim(`(answer with: am allow ${agent.name} / am deny ${agent.name})`))
      return true
    }
    return false
  }
  let finished = false
  for (const s of missed.items) if (consider(s)) finished = true
  if (!finished)
    await new Promise<void>((resolve) => {
      events.on('frame', (f: EventFrame) => {
        if (f.type !== 'agent.item' || !('agentId' in f) || f.agentId !== agent.id) return
        if (consider((f as { item: StoredItem }).item)) resolve()
      })
    })
  events.close()
}

async function turn(rest: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { 'no-wait': { type: 'boolean' } },
  })
  const api = client()
  const { agent } = await findAgent(api, need(positionals[0], 'agent'))
  const text = positionals.slice(1).join(' ')
  if (!text) throw new Error('a text is required')
  const { total } = await api.items(agent.id, { tail: 0 })
  await api.turn(agent.id, text)
  if (values['no-wait']) {
    io.out('sent')
    return 0
  }
  await follow(api, agent, total, io)
  return 0
}

async function decide(cmd: 'allow' | 'deny', rest: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { option: { type: 'string' }, 'no-wait': { type: 'boolean' } },
  })
  const api = client()
  const { agent } = await findAgent(api, need(positionals[0], 'agent'))
  const { items, total } = await api.items(agent.id, { tail: 50 })
  const pending = [...items].reverse().find((s) => s.item.kind === 'permission' && !s.item.decision)
  if (!pending || pending.item.kind !== 'permission') throw new Error('no permission is pending')
  const option =
    values.option ??
    pending.item.options.find((o) => (cmd === 'allow' ? o.kind === 'allow' : o.kind === 'deny'))?.id
  if (!option)
    throw new Error(
      `no ${cmd} option; offered: ${pending.item.options.map((o) => o.id).join(', ')}`,
    )
  await api.decide(agent.id, pending.item.requestId, option)
  io.out(`${pending.item.title || pending.item.tool}: ${option}`)
  if (!values['no-wait']) await follow(api, agent, total, io)
  return 0
}
