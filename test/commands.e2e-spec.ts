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
async function am(args: string[], answers: string[] = [], stdin: string | null = null) {
  const out: string[] = []
  const err: string[] = []
  const io: Io = {
    out: (l) => out.push(strip(l)),
    err: (l) => err.push(strip(l)),
    ask: async () => answers.shift() ?? '',
    stdin: async () => stdin,
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

  it('exec: one argument verbatim, several re-quoted, or the command on stdin', async () => {
    const one = await am(['exec', os.hostname(), '--', 'printf "%s|" "a  b" $((1+1)); exit 3'])
    expect(one.text).toBe('a  b|2|')
    expect(one.code).toBe(3)
    // the caller's shell has stripped the quotes from these words; the spaced one is quoted again
    const many = await am(['exec', os.hostname(), '--', 'printf', '%s|', 'a  b', 'c'])
    expect(many.text).toBe('a  b|c|')
    const piped = await am(
      ['exec', os.hostname()],
      [],
      "printf '%s|' \"it's\" 'q\"q'\nprintf 'line2'\n",
    )
    expect(piped.text).toBe('it\'s|q"q|line2')
    expect(piped.code).toBe(0)
    const nothing = await am(['exec', os.hostname()], [], '')
    expect(nothing.code).toBe(1)
    expect(nothing.err[0]).toMatch(/stdin/)
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
    expect(quiet.out).toHaveLength(2) // one text, then the turn end: nothing of the run itself
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
    // a turn with thinking and a tool call in it: the text and the end, the call and the thinking kept out
    const tooled = await am(['turn', 'demo/worker', 'tool', '--quiet'])
    expect(tooled.code).toBe(0)
    expect(tooled.out).toHaveLength(2)
    expect(tooled.text).not.toContain('Read')
    expect(tooled.text).not.toContain('look at the file')
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

  it('chat: a person leaves a message beside the work, the agent reads it, says, decides and asks', async () => {
    process.env.AGENT_MANAGER_PASSWORD = ADMIN_PASSWORD
    expect((await am(['login', '--name', 'admin', '--url', backend.url])).code).toBe(0)
    const api = new Api(backend.url)
    await api.login('admin', ADMIN_PASSWORD)
    const { agent } = await api.createAgent(projectId, { name: 'talker' })
    await api.turn(agent.id, 'token please')
    let token = ''
    for (let i = 0; i < 100 && !token; i++) {
      const { items } = await api.items(agent.id, { tail: 20 })
      for (const it of items)
        if (it.item.kind === 'text') token = /token ([0-9a-f]{64})/.exec(it.item.text)?.[1] ?? token
      if (!token) await new Promise((r) => setTimeout(r, 100))
    }
    const state = async () => (await api.agent(agent.id)).status.state
    const until = async (want: string) => {
      for (let i = 0; i < 100 && (await state()) !== want; i++)
        await new Promise((r) => setTimeout(r, 100))
      expect(await state()).toBe(want)
    }
    await until('idle')
    // a person, from a terminal: outside a session the agent has to be named
    expect((await am(['say', 'hello'])).err[0]).toMatch(/name the agent/)
    expect((await am(['chat'])).err[0]).toMatch(/name the agent/)
    await api.turn(agent.id, 'linger')
    await until('working')
    const left = await am(['say', '--to', 'talker', 'the', 'header', 'is', 'misaligned'])
    expect(left.code).toBe(0)
    expect(left.text).toMatch(/^left for talker beside its work \(#\d+\): unread/)
    // multi-line Markdown goes on stdin, untouched
    expect((await am(['say', '--to', 'demo/talker'], [], 'and:\n\n- "one"\n- `two`\n')).code).toBe(
      0,
    )
    const seen = await am(['chat', 'talker'])
    expect(seen.text).toContain('the header is misaligned')
    expect(seen.text).toContain('- "one"\n- `two`')
    expect(seen.text.match(/unread/g)).toHaveLength(2) // a person looking marks nothing
    expect((await am(['chat', 'talker'])).text.match(/unread/g)).toHaveLength(2)
    expect((await am(['say', '--to', 'talker', '--decision', 'x'])).code).toBe(2)

    // the agent, in its session: the token says who it is
    process.env.AGENT_MANAGER_URL = backend.url
    process.env.AGENT_MANAGER_TOKEN = token
    try {
      const back = await am(['chat', '--last', '2']) // reading back marks nothing
      expect(back.text).toContain('the header is misaligned')
      expect(back.out.at(-1)).toMatch(/^2 unread: `am chat` prints and marks them read$/)
      const read = await am(['chat'])
      expect(read.code).toBe(0)
      expect(read.text).toMatch(/#\d+  admin  \d\d:\d\d\nthe header is misaligned\n/)
      expect(read.text).toContain('and:\n\n- "one"\n- `two`')
      expect(read.text).not.toContain('unread')
      expect((await am(['chat'])).text).toBe('nothing unread')

      const said = await am(['say', 'The store is in; starting on the hook.'])
      expect(said.text).toMatch(/^said \(#\d+\)$/)
      const decided = await am(['say', '--decision', '--important'], [], 'Kept it in SQLite.\n')
      expect(decided.text).toMatch(/^decision said \(#\d+\), sent to their phones$/)
      const asked = await am(['say', '--question', 'Blue or green?'])
      expect(asked.text).toMatch(/^asked \(#\d+\): sent to their phones and pinned until answered/)
      const q = /#(\d+)/.exec(asked.text)![1]!
      expect((await am(['say', '--decision', '--question', 'x'])).code).toBe(2)
      expect((await am(['say'], [], '  \n')).code).toBe(1)
      const own = await am(['chat', '--last', '3'])
      expect(own.text).toMatch(/#\d+  talker  \d\d:\d\d\nThe store is in/)
      expect(own.text).toMatch(/#\d+  talker  important decision  \d\d:\d\d\nKept it in SQLite\./)
      expect(own.text).toMatch(new RegExp(`#${q}  talker  question, open  `))

      // the answer, from the person, while the agent works: announced as what it is
      delete process.env.AGENT_MANAGER_URL
      delete process.env.AGENT_MANAGER_TOKEN
      expect((await am(['say', '--to', 'talker', '--re', q, 'Green.'])).code).toBe(0)
      process.env.AGENT_MANAGER_URL = backend.url
      process.env.AGENT_MANAGER_TOKEN = token
      const answer = await am(['chat'])
      expect(answer.text).toMatch(
        new RegExp(`#\\d+  admin  \\d\\d:\\d\\d  answer to #${q} "Blue or green\\?"\nGreen\\.`),
      )
      expect((await am(['chat', '--last', '9'])).text).toMatch(
        new RegExp(`#${q}  talker  question, answered  `),
      )

      // a question it no longer needs answered
      const again = await am(['say', '--question', 'Tabs?'])
      const q2 = /#(\d+)/.exec(again.text)![1]!
      expect((await am(['chat'])).out.at(-1)).toBe('1 of your questions is still open')
      expect((await am(['chat', 'close', q2])).text).toBe(`closed #${q2}`)
      expect((await am(['chat', '--last', '1'])).text).toMatch(/question, closed/)
      expect((await am(['chat', 'close', 'nope'])).code).toBe(1)
      // its dialog with the person, by number: both sides, word for word, the chat included
      const index = await am(['recall'])
      expect(index.out[0]).toMatch(/^#1  \d{4}-\d\d-\d\d  -  token please$/)
      expect(index.text).toMatch(
        /#\d+  \d{4}-\d\d-\d\d  -  \[in the chat\] the header is misaligned/,
      )
      expect(index.out.at(-1)).toMatch(/^this manager weighs no dialog/)
      const one = await am(['recall', '1'])
      expect(one.text).toMatch(
        /^#1  \d{4}-\d\d-\d\d \d\d:\d\d UTC\nadmin:\ntoken please\n\nagent:\nMy manager: /,
      )
      expect((await am(['recall', '1-2'])).text).toMatch(/\n#2  /)
      expect((await am(['recall', '999'])).err[0]).toMatch(/no exchange #999/)
      expect((await am(['recall', 'x'])).code).toBe(2)
      expect((await am(['recall', '--weigh'])).err[0]).toMatch(/no classifier is configured/)
      const now = await am(['recall', '--handback', '--now'])
      expect(now.text).toMatch(/asked for now, without a compaction/)
      expect(now.text).toMatch(/\/handback\/[0-9a-f-]+\/dialog-1\.md/)
      const would = await am(['recall', '--handback'])
      expect(would.out[0]).toMatch(/^recent, whole: #1 #2/)
      expect(would.out[1]).toBe('earlier, whole: none')
      expect(would.out[2]).toMatch(
        /^0 more as one line each; about [\d,]+ tokens of a budget of 20,000, in 1 file$/,
      )
      expect((await am(['recall', '--handback', '--full'])).text).toContain(
        '## The most recent exchanges, word for word',
      )
    } finally {
      delete process.env.AGENT_MANAGER_URL
      delete process.env.AGENT_MANAGER_TOKEN
    }
    expect((await am(['recall'])).err[0]).toMatch(/name the agent/)
    expect((await am(['recall', '--handback', '--now', '--agent', 'talker'])).err[0]).toMatch(
      /an agent's own/,
    )
    expect((await am(['recall', '--agent', 'talker', '1'])).text).toContain('token please')
    // a steer from the terminal goes into the turn; to an idle agent it is a turn
    expect((await am(['say', '--to', 'talker', '--steer', 'stop'])).text).toMatch(
      /^steered into talker's turn/,
    )
    await api.interrupt(agent.id)
    await until('idle')
    expect((await am(['say', '--to', 'talker', 'hello again'])).text).toMatch(
      /^sent to talker as a turn/,
    )
    await until('idle')
    // stop, edit, go: the last message is taken back while the agent works on it, and printed
    await api.turn(agent.id, 'linger on the wrnog thing')
    await until('working')
    const undone = await am(['undo', 'talker'])
    expect(undone.code).toBe(0)
    expect(undone.out[0]).toMatch(/^taken back: the agent still has the message \(fake keeps/)
    expect(undone.out.at(-1)).toBe('linger on the wrnog thing')
    await until('idle')
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

  it('sets a project’s delegation at creation and with set, and refuses a bad value', async () => {
    process.env.AGENT_MANAGER_PASSWORD = ADMIN_PASSWORD
    expect((await am(['login', '--name', 'admin', '--url', backend.url])).code).toBe(0)
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'am-cli-deleg-'))
    fs.mkdirSync(path.join(base, 'r'))
    const made = await am([
      'project',
      'new',
      'guarded',
      path.join(base, 'r'),
      '--delegation',
      'on-request',
    ])
    expect(made.code).toBe(0)
    // set it back to free
    const set = await am(['project', 'set', 'guarded', '--delegation', 'free'])
    expect(set.code).toBe(0)
    expect(set.text).toContain('delegation free')
    // a bad value is a usage error (exit 2)
    const bad = await am(['project', 'set', 'guarded', '--delegation', 'sometimes'])
    expect(bad.code).toBe(2)
    expect(bad.err.join('\n')).toMatch(/free.*on-request/)
    // set with nothing to change is a usage error too
    expect((await am(['project', 'set', 'guarded'])).code).toBe(2)
  })
})
