import fs from 'node:fs'
import { parseArgs } from 'node:util'
import readline from 'node:readline'
import { Api, ApiError } from './api.js'
import { clearSession, loadSession, managerUrl, saveSession } from './config.js'
import { client, findAgent, findProject } from './client.js'
import { Events } from './events.js'
import { bold, dim, renderItem, stateMark } from './render.js'
import type { Agent, EventFrame, StoredItem, TurnImage } from './types.js'

export interface Io {
  out: (line: string) => void
  err: (line: string) => void
  /** Reads a line from the user; `hidden` for passwords. */
  ask: (prompt: string, hidden?: boolean) => Promise<string>
}

export const USAGE = `am — terminal client for agent-manager

  am                          open the TUI
  am login [--name NAME] [--url URL]   (AGENT_MANAGER_PASSWORD in the environment skips the prompt)
  am logout
  am projects
  am agents <project>
  am new <project> <name> [--profile P] [--ask] [--cwd REPO] [--model M] [--effort E]
  am tail <agent> [--lines N] [--follow] [--full]
  am turn <agent> <text...>   send a turn and print it as it runs (--no-wait: just send;
                              --steer: while a turn runs, deliver it into the turn or queue it;
                              --image FILE: send an image along, repeatable; png/jpeg/gif/webp)
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
        return await (await import('./tui/index.tsx')).tui(io)
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
    if (e instanceof UsageError || (e instanceof TypeError && /option|argument/i.test(e.message))) {
      io.err(`${e.message}\n\n${USAGE}`)
      return 2
    }
    io.err(
      e instanceof ApiError
        ? e.status === 401
          ? 'not logged in (or the login expired): run `am login`'
          : `${e.message} (${e.status})`
        : e instanceof Error
          ? e.message
          : String(e),
    )
    return 1
  }
}

class UsageError extends Error {}
function need(v: string | undefined, what: string): string {
  if (!v) throw new UsageError(`${what} is required`)
  return v
}

async function login(rest: string[], io: Io): Promise<number> {
  const { values } = parseArgs({
    args: rest,
    options: { name: { type: 'string' }, url: { type: 'string' } },
  })
  const url = (
    values.url ??
    process.env.AGENT_MANAGER_URL ??
    loadSession()?.url ??
    managerUrl()
  ).replace(/\/$/, '')
  const name = values.name ?? (await io.ask('user: '))
  // scripts pass the password in the environment, never on the command line (ps, history)
  const password = process.env.AGENT_MANAGER_PASSWORD ?? (await io.ask('password: ', true))
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
  let lost = false
  await new Promise<void>((resolve) => {
    events.on('error', (e) => {
      io.err(e.message)
      if (/not logged in/.test(e.message)) {
        lost = true
        resolve()
      }
    })
    let from = Math.max(0, total - n) // refetched on each connection: updates to the last items too
    events.on('frame', (f: EventFrame) => {
      if (f.type === 'agent.item' && 'agentId' in f && f.agentId === agent.id) {
        const s = (f as { item: StoredItem }).item
        if (s.item.kind === 'text' && s.item.streaming) return // print text once it is complete
        print(s)
        from = Math.max(from, s.index - n)
      }
      if (f.type === 'agent.reset') {
        io.out(dim('· transcript rebuilt by the manager'))
        shown.clear()
        from = 0
      }
    })
    events.on('open', () => {
      void api
        .items(agent.id, { from })
        .then((r) => {
          for (const s of r.items) if (!(s.item.kind === 'text' && s.item.streaming)) print(s)
        })
        .catch((e: Error) => io.err(e.message))
    })
    events.connect()
    process.on('SIGINT', () => {
      events.close()
      resolve()
    })
  })
  events.close()
  return lost ? 1 : 0
}

/**
 * Prints the items of the turn under way as they arrive, until it ends,
 * errors or stops to ask a permission. `total` is the index the turn's
 * items start at.
 */
/**
 * Prints the items of the turn under way as they arrive, until it ends
 * (a turn end, an error, the session ending) or stops to ask a
 * permission. `total` is the index the turn's items start at. Each
 * (re)connection refetches from there, so nothing is missed in a gap;
 * an item updated in place prints again only if its line changed, and a
 * text identical to the one just printed (Claude finalises a text twice)
 * is not repeated.
 */
async function follow(
  api: Api,
  agent: Agent,
  total: number,
  io: Io,
): Promise<'ended' | 'error' | 'permission' | 'lost'> {
  const events = new Events(api.url, api.cookie!)
  const printed = new Map<number, string>()
  let lastText = ''
  let outcome: 'ended' | 'error' | 'permission' | 'lost' | null = null
  const settle = (o: typeof outcome) => (outcome ??= o)
  const consider = (s: StoredItem): void => {
    if (s.index < total) return
    if (s.item.kind === 'text' && s.item.streaming) return // print text once it is complete
    const line = renderItem(s)
    if (printed.get(s.index) === line) return
    printed.set(s.index, line)
    if (s.item.kind === 'text') {
      if (s.item.text === lastText) return
      lastText = s.item.text
    }
    io.out(line)
    if (s.item.kind === 'turn_end') settle('ended')
    else if (s.item.kind === 'error') settle('error')
    else if (s.item.kind === 'system' && s.item.text.startsWith('session ended')) settle('ended')
    else if (s.item.kind === 'permission' && !s.item.decision) {
      io.out(dim(`(answer with: am allow ${agent.name} / am deny ${agent.name})`))
      settle('permission')
    }
  }
  const done = new Promise<void>((resolve) => {
    const check = () => outcome && resolve()
    events.on('frame', (f: EventFrame) => {
      if (f.type === 'agent.reset') {
        io.out(dim('· the transcript was rebuilt by the manager; follow it with am tail --follow'))
        settle('lost')
        return check()
      }
      if (f.type !== 'agent.item' || !('agentId' in f) || f.agentId !== agent.id) return
      consider((f as { item: StoredItem }).item)
      check()
    })
    // each (re)connection: whatever landed while we were not listening
    events.on('open', () => {
      void api
        .items(agent.id, { from: total })
        .then((r) => {
          for (const s of r.items) consider(s)
          check()
        })
        .catch((e: Error) => {
          io.err(e.message)
          settle('lost')
          check()
        })
    })
    events.on('error', (e) => {
      io.err(e.message)
      if (/not logged in/.test(e.message)) {
        settle('lost')
        check()
      }
    })
  })
  try {
    events.connect()
    const opened = await Promise.race([
      new Promise<true>((r) => events.once('open', () => r(true))),
      new Promise<false>((r) => setTimeout(() => r(false), 10_000).unref()),
    ])
    if (!opened && !outcome) {
      io.err('the event stream did not open; the turn was sent, follow it with am tail --follow')
      return 'lost'
    }
    await done
    return outcome ?? 'lost'
  } finally {
    events.close()
  }
}

async function turn(rest: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      'no-wait': { type: 'boolean' },
      steer: { type: 'boolean' },
      image: { type: 'string', multiple: true },
    },
  })
  const api = client()
  const { agent } = await findAgent(api, need(positionals[0], 'agent'))
  const text = positionals.slice(1).join(' ')
  if (!text) throw new Error('a text is required')
  const images = (values.image ?? []).map(readImage)
  const { total } = await api.items(agent.id, { tail: 0 })
  const { mode } = await api.turn(agent.id, text, values.steer, images)
  if (mode === 'queued') {
    io.out(dim('queued: the agent cannot take a message mid-turn; it is sent when this turn ends'))
    return 0
  }
  if (values['no-wait']) {
    io.out(mode)
    return 0
  }
  return (await follow(api, agent, total, io)) === 'error' ? 1 : 0
}

async function decide(cmd: 'allow' | 'deny', rest: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { option: { type: 'string' }, 'no-wait': { type: 'boolean' } },
  })
  const api = client()
  const { agent } = await findAgent(api, need(positionals[0], 'agent'))
  const { items, total } = await api.items(agent.id, { tail: 200 })
  const pendingOf = (list: StoredItem[]) => {
    const open: StoredItem[] = []
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i]!
      if (s.item.kind === 'turn_end' || s.item.kind === 'error') break
      if (s.item.kind === 'permission' && !s.item.decision) open.unshift(s)
    }
    return open
  }
  const pending = pendingOf(items)[0]
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
  if (values['no-wait']) return 0
  const still = pendingOf((await api.items(agent.id, { tail: 200 })).items).filter(
    (s) => s.index !== pending.index,
  )
  if (still.length) {
    io.out(
      dim(
        `${still.length} more permission(s) pending: am allow ${agent.name} / am deny ${agent.name}`,
      ),
    )
    return 0
  }
  return (await follow(api, agent, total, io)) === 'error' ? 1 : 0
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** An image file for a turn: base64 with the media type from its extension. */
function readImage(file: string): TurnImage {
  const ext = file.toLowerCase().split('.').pop() ?? ''
  const mediaType = IMAGE_TYPES[ext]
  if (!mediaType) throw new UsageError(`${file}: not a png, jpeg, gif or webp`)
  return { mediaType, data: fs.readFileSync(file).toString('base64') }
}
