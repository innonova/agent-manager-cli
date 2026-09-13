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
    const stopped = await am(['stop', 'worker'])
    expect(stopped.code).toBe(0)
    fs.mkdirSync(path.join(backend.projectDir, 'features'), { recursive: true })
    fs.writeFileSync(
      path.join(backend.projectDir, 'features', 'thing.md'),
      '---\ntitle: a thing\nstatus: planned\npriority: 10\n---\n\nDo the thing.\n',
    )
    await new Promise((r) => setTimeout(r, 3500)) // the manager polls features every 3 s
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
})
