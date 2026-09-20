import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADMIN_PASSWORD, startBackend, type Backend } from './backend.js'
import { run, type Io } from '../src/commands.js'
import { Api } from '../src/api.js'

let backend: Backend
let projectId: string
// oxlint-disable-next-line no-control-regex
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

/** Runs a command with captured output and a scripted stdin. */
async function am(args: string[], answers: string[] = []) {
  const out: string[] = []
  const err: string[] = []
  const io: Io = {
    out: (l) => out.push(strip(l)),
    err: (l) => err.push(strip(l)),
    ask: async () => answers.shift() ?? '',
  }
  const code = await run(args, io)
  return { code, out, err, text: out.join('\n') }
}

beforeAll(async () => {
  // under an agent's session these point `am` at the real manager; the tests drive their own
  delete process.env.AGENT_MANAGER_TOKEN
  delete process.env.AGENT_MANAGER_URL
  backend = await startBackend()
  process.env.AGENT_MANAGER_CLI_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'am-cli-cfg-'))
  const api = new Api(backend.url)
  await api.login('admin', ADMIN_PASSWORD)
  const res = await fetch(`${backend.url}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: api.cookie! },
    body: JSON.stringify({ name: 'demo', path: backend.projectDir, defaultProfile: 'fake' }),
  })
  projectId = ((await res.json()) as { project: { id: string } }).project.id
})

afterAll(async () => {
  await backend?.stop()
  fs.rmSync(process.env.AGENT_MANAGER_CLI_CONFIG_DIR!, { recursive: true, force: true })
})

describe('plain commands', () => {
  it('refuses everything before login, then logs in and keeps the cookie in a private file', async () => {
    expect((await am(['projects'])).err[0]).toMatch(/not logged in/)
    const bad = await am(['login', '--url', backend.url], ['admin', 'wrong'])
    expect(bad.code).toBe(1)
    const ok = await am(['login', '--url', backend.url], ['admin', ADMIN_PASSWORD])
    expect(ok.code).toBe(0)
    expect(ok.text).toContain('logged in')
    const file = path.join(process.env.AGENT_MANAGER_CLI_CONFIG_DIR!, 'session.json')
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    const p = await am(['projects'])
    expect(p.code).toBe(0)
    expect(p.text).toContain('demo')
    expect(p.text).toContain(projectId)
  })

  it('creates an agent, sends a turn and tails the transcript', async () => {
    const created = await am(['new', 'demo', 'worker'])
    expect(created.code).toBe(0)
    expect(created.text).toContain('worker')
    const listed = await am(['agents', 'demo'])
    expect(listed.text).toMatch(/worker\s+(starting|idle)/)
    const turned = await am(['turn', 'demo/worker', 'hello', 'there'])
    expect(turned.code).toBe(0)
    expect(turned.text).toContain('You said: hello there')
    expect(turned.text).toContain('turn end')
    // quiet: the answer and the turn-end line, nothing of the run itself
    const quiet = await am(['turn', 'demo/worker', 'again', '--quiet'])
    expect(quiet.code).toBe(0)
    expect(quiet.out).toHaveLength(2)
    expect(quiet.out[0]).toMatch(/^You said: again/)
    expect(quiet.out[1]).toContain('turn end')
    // wait with nothing under way: the last answer, from the transcript
    const waited = await am(['wait', 'worker'])
    expect(waited.code).toBe(0)
    expect(waited.out[0]).toMatch(/^You said: again/)
    expect(waited.out[1]).toContain('turn end')
    // wait during a turn: sent without waiting, then collected
    expect((await am(['turn', 'demo/worker', 'slow please', '--no-wait'])).code).toBe(0)
    const collected = await am(['wait', 'worker'])
    expect(collected.code).toBe(0)
    expect(collected.out[0]).toContain('deliberately slow')
    expect(collected.out[1]).toContain('turn end')
    const tailed = await am(['tail', 'worker', '--lines', '3'])
    expect(tailed.code).toBe(0)
    expect(tailed.out.length).toBe(3)
    expect(tailed.text).toContain('turn end')
    const byName = await am(['tail', 'nobody'])
    expect(byName.err[0]).toMatch(/no agent "nobody"/)
  })

  it('answers a permission with allow and deny', async () => {
    await am(['new', 'demo', 'careful', '--ask'])
    const asked = await am(['turn', 'demo/careful', 'permission please'])
    expect(asked.err).toEqual([])
    expect(asked.text).toMatch(/waiting/)
    expect(asked.text).toContain('am allow careful')
    const denied = await am(['deny', 'careful'])
    expect(denied.code).toBe(0)
    expect(denied.text).toContain('turn end') // the answer is followed to the end of the turn
    const again = await am(['turn', 'demo/careful', 'permission again'])
    expect(again.text).toMatch(/waiting/)
    const allowed = await am(['allow', 'careful'])
    expect(allowed.code).toBe(0)
    expect((await am(['allow', 'careful'])).err[0]).toMatch(/no permission is pending/)
    const items = await am(['tail', 'careful', '--lines', '100'])
    expect(items.text).toMatch(/answered/)
  })

  it('stops an agent and lists features', async () => {
    const restarted = await am(['restart', 'worker'])
    expect(restarted.code).toBe(0)
    expect(restarted.text).toContain('restarted')
    const stopped = await am(['stop', 'worker'])
    expect(stopped.code).toBe(0)
    fs.mkdirSync(path.join(backend.projectDir, 'features'), { recursive: true })
    fs.writeFileSync(
      path.join(backend.projectDir, 'features', 'thing.md'),
      '---\ntitle: a thing\nstatus: planned\npriority: 10\n---\n\nDo the thing.\n',
    )
    await new Promise((r) => setTimeout(r, 3500)) // the manager polls features every 3 s
    expect((await am(['runs', 'demo'])).text).toContain('no runs yet') // nothing went in-progress under an agent
    // the shipped texts, which the backend now falls back to: its own
    // config files are in its temp root, not the developer's
    expect((await am(['method'])).text).toContain('Bringing an agent in')
    expect((await am(['framing'])).text).toContain('Writing a feature')
    expect((await am(['learnings'])).text).toContain('nothing recorded yet')
    expect((await am(['learn', 'The fake agent', 'has no taste.', '--ref', 'demo'])).text).toMatch(
      /recorded as #1/,
    )
    const learned = await am(['learnings'])
    expect(learned.text).toContain('#1')
    expect(learned.text).toContain('The fake agent has no taste.')
    expect(learned.text).toContain('demo')
    expect((await am(['runs', 'review', 'nope', '--outcome', 'accepted'])).err[0]).toMatch(
      /404|no run/,
    )
    expect((await am(['runs', 'review', 'nope'])).code).toBe(2) // --outcome is required
    const list = await am(['features', 'demo'])
    expect(list.text).toContain('thing')
    const one = await am(['feature', 'demo', 'thing'])
    expect(one.text).toContain('Do the thing')
    const responded = await am(['respond', 'demo', 'thing', 'go ahead', '--status', 'planned'])
    expect(responded.text).toContain('thing: planned')
    expect((await am(['feature', 'demo', 'thing'])).text).toContain('go ahead')
    expect((await am(['logout'])).text).toContain('logged out')
    expect((await am(['projects'])).err[0]).toMatch(/not logged in/)
  })

  it('inside an agent session the token in the environment logs in, scoped to the project', async () => {
    // the token is in the agent's environment; the fake agent repeats it on a "token" turn
    const api = new Api(backend.url)
    await api.login('admin', ADMIN_PASSWORD)
    const { agent } = await api.createAgent(projectId, { name: 'boss' })
    await api.turn(agent.id, 'token please')
    let token = ''
    for (let i = 0; i < 100 && !token; i++) {
      const { items } = await api.items(agent.id, { tail: 20 })
      for (const it of items)
        if (it.item.kind === 'text') token = /token ([0-9a-f]{64})/.exec(it.item.text)?.[1] ?? token
      if (!token) await new Promise((r) => setTimeout(r, 100))
    }
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    process.env.AGENT_MANAGER_URL = backend.url
    process.env.AGENT_MANAGER_TOKEN = token
    try {
      expect((await am(['projects'])).code).toBe(0) // no login: the token
      const made = await am(['new', 'demo', 'helper'])
      expect(made.code).toBe(0)
      expect((await am(['agents', 'demo'])).text).toContain('helper')
      expect((await am(['archive', 'helper'])).text).toContain('archived')
      expect((await am(['agents', 'demo'])).text).not.toContain('helper')
      expect((await am(['agents', 'demo', '--archived'])).text).toContain('helper')
      expect((await am(['delete', 'helper'])).text).toContain('deleted')
      expect((await am(['agents', 'demo', '--archived'])).text).not.toContain('helper')
      expect((await am(['project', 'new', 'nope', backend.projectDir])).code).toBe(1) // outside the scope
    } finally {
      delete process.env.AGENT_MANAGER_URL
      delete process.env.AGENT_MANAGER_TOKEN
    }
  })

  it('creates a project with several repos, adds one later and restarts its agents', async () => {
    process.env.AGENT_MANAGER_PASSWORD = ADMIN_PASSWORD
    expect((await am(['login', '--name', 'admin', '--url', backend.url])).code).toBe(0)
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'am-cli-repos-'))
    for (const n of ['alpha', 'beta', 'gamma']) fs.mkdirSync(path.join(base, n))
    const made = await am([
      'project',
      'new',
      'multi',
      path.join(base, 'alpha'),
      path.join(base, 'beta'),
    ])
    expect(made.code).toBe(0)
    expect(made.text).toContain('alpha')
    expect(made.text).toContain('beta')
    const added = await am(['project', 'add-repo', 'multi', path.join(base, 'gamma')])
    expect(added.code).toBe(0)
    expect(added.out.filter((l) => /alpha|beta|gamma/.test(l))).toHaveLength(3)
    const listed = await am(['projects'])
    expect(listed.text).toContain(path.join(base, 'gamma'))
    const restarted = await am(['project', 'restart', 'multi'])
    expect(restarted.code).toBe(0)
    expect(restarted.text).toContain('restarted 0 agents')
    const bad = await am(['project', 'add-repo', 'multi', path.join(base, 'missing')])
    expect(bad.code).toBe(1)
    expect(bad.err[0]).toMatch(/not a directory/)
    expect((await am(['project'])).code).toBe(2)
  })
})
