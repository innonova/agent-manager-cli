import { EventEmitter } from 'node:events'
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App.tsx'
import { Composer } from './Composer.tsx'
import { Store, type ApiLike, type EventsLike } from './store.js'
import type { AgentRow, EventFrame, Project, StoredItem } from '../types.js'

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms))
// oxlint-disable-next-line no-control-regex
const plain = (s: string | undefined) => (s ?? '').replace(/\x1b\[[0-9;]*m/g, '')

const project: Project = {
  id: 'p1',
  name: 'demo',
  path: '/tmp/demo',
  repos: [{ name: 'demo', path: '/tmp/demo' }],
  defaultProfile: 'fake',
  createdAt: 0,
}
const worker: AgentRow = {
  agent: {
    id: 'a1',
    projectId: 'p1',
    name: 'worker',
    profile: 'fake',
    cwd: '/tmp/demo',
    vendorConversationId: null,
    currentSessionId: 's1',
    createdAt: 0,
    archivedAt: null,
    permissions: 'ask',
    model: null,
    effort: null,
  },
  status: {
    state: 'idle',
    error: null,
    lastActivityAt: 0,
    background: 0,
    model: 'fake-1',
    queued: 0,
    usage: null,
  },
}
const item = (index: number, it: StoredItem['item']): StoredItem => ({
  index,
  sessionId: 's1',
  seqFrom: index,
  seqTo: index,
  at: 0,
  item: it,
})

/** A store over a scripted API and a hand-driven event stream. */
function scripted() {
  const history: StoredItem[] = [
    item(0, { kind: 'system', text: 'session started (s1)' }),
    item(1, { kind: 'user', text: 'hello', by: 'admin' }),
    item(2, { kind: 'text', text: 'Hi **there**', streaming: false }),
    item(3, { kind: 'turn_end' }),
  ]
  const api = {
    projects: vi.fn(async () => [{ project, agentCounts: { idle: 1 } }]),
    agents: vi.fn(async () => [worker]),
    agent: vi.fn(async () => ({ ...worker, sessions: [] })),
    items: vi.fn(
      async (_id: string, q: { tail?: number; before?: number; limit?: number; from?: number }) => {
        if (q.before !== undefined)
          return {
            items: history.slice(Math.max(0, q.before - q.limit!), q.before),
            total: history.length,
          }
        if (q.from !== undefined) return { items: history.slice(q.from), total: history.length }
        return { items: history.slice(-(q.tail ?? 200)), total: history.length }
      },
    ),
    turn: vi.fn(async () => ({ ok: true as const, mode: 'sent' as const })),
    decide: vi.fn(async () => ({ ok: true as const })),
    interrupt: vi.fn(async () => ({ ok: true as const })),
    stop: vi.fn(async () => ({ ok: true as const })),
    createAgent: vi.fn(async (_p: string, input: { name: string }) => ({
      ...worker,
      agent: { ...worker.agent, id: 'a2', name: input.name },
    })),
    profiles: vi.fn(async () => ({
      profiles: [
        { name: 'fake', supported: true },
        { name: 'codex', supported: true },
      ],
    })),
    features: vi.fn(async () => ({ features: [] })),
    feature: vi.fn(),
    respond: vi.fn(),
  } as unknown as ApiLike
  const emitter = new EventEmitter()
  const events = {
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    connect: vi.fn(() => {
      emitter.emit('open')
      emitter.emit('frame', { type: 'hello', user: 'admin', daemon: { connected: true } })
    }),
    close: vi.fn(),
    presence: vi.fn(),
  } as unknown as EventsLike
  const store = new Store(api, events)
  const bell = vi.fn()
  store.bell = bell
  return { store, api, events, emit: (f: EventFrame) => emitter.emit('frame', f), history, bell }
}

describe('Composer', () => {
  it('types, inserts newlines with Alt+Enter, and sends on Enter', async () => {
    let value = ''
    const onSubmit = vi.fn()
    const view = () => (
      <Composer
        value={value}
        onChange={(v) => (value = v)}
        onSubmit={onSubmit}
        focus
        placeholder="say"
      />
    )
    const r = render(view())
    expect(plain(r.lastFrame())).toContain('say')
    r.stdin.write('hi')
    await tick()
    r.rerender(view())
    expect(value).toBe('hi')
    r.stdin.write('\x1b\r') // Alt+Enter
    await tick()
    r.rerender(view())
    expect(value).toBe('hi\n')
    r.stdin.write('\x1b[13;2u') // Shift+Enter as a CSI u terminal sends it
    await tick()
    r.rerender(view())
    r.stdin.write('\x1b[27;2;13~') // Shift+Enter as xterm's modifyOtherKeys sends it
    await tick()
    r.rerender(view())
    r.stdin.write('\n') // Ctrl+J
    await tick()
    r.rerender(view())
    expect(value).toBe('hi\n\n\n\n')
    r.stdin.write('there')
    await tick()
    r.rerender(view())
    expect(plain(r.lastFrame())).toContain('there')
    r.stdin.write('\r')
    await tick()
    expect(onSubmit).toHaveBeenCalledWith('hi\n\n\n\nthere')
  })
})

describe('App', () => {
  it('walks projects → agents → chat, shows the tail and live items, sends a turn', async () => {
    const { store, api, emit } = scripted()
    const r = render(<App store={store} size={{ columns: 100, rows: 30 }} />)
    store.start()
    await tick()
    expect(plain(r.lastFrame())).toContain('demo')
    r.stdin.write('\r')
    await tick()
    expect(plain(r.lastFrame())).toContain('worker')
    r.stdin.write('\r')
    await tick(60)
    const frame = plain(r.lastFrame())
    expect(frame).toContain('admin: hello')
    expect(frame).toContain('there') // markdown rendered
    expect(frame).toContain('turn end')
    emit({
      type: 'agent.item',
      agentId: 'a1',
      item: item(4, { kind: 'user', text: 'again', by: 'admin' }),
    })
    emit({
      type: 'agent.item',
      agentId: 'a1',
      item: item(5, { kind: 'text', text: 'partial', streaming: true }),
    })
    emit({
      type: 'agent.item',
      agentId: 'a1',
      item: item(5, { kind: 'text', text: 'partial and done', streaming: false }),
    })
    await tick()
    expect(plain(r.lastFrame())).toContain('partial and done')
    expect(plain(r.lastFrame())).not.toMatch(/partial\s*▍/)
    r.stdin.write('do it')
    await tick()
    r.stdin.write('\r')
    await tick()
    expect(api.turn).toHaveBeenCalledWith('a1', 'do it', false)
  })

  it('a permission takes focus, a number answers it, and the bell rings for another agent', async () => {
    const { store, api, emit, bell } = scripted()
    const r = render(<App store={store} size={{ columns: 100, rows: 30 }} />)
    store.start()
    await tick()
    r.stdin.write('\r')
    await tick()
    r.stdin.write('\r')
    await tick(60)
    emit({
      type: 'agent.item',
      agentId: 'a1',
      item: item(4, {
        kind: 'permission',
        requestId: 'req-1',
        tool: 'Bash',
        title: 'Remove the build directory',
        input: { command: 'rm -rf dist' },
        options: [
          { id: 'allow', kind: 'allow', label: 'Allow' },
          { id: 'deny', kind: 'deny', label: 'Deny' },
        ],
        decision: null,
      }),
    })
    await tick()
    expect(plain(r.lastFrame())).toContain('Remove the build directory')
    expect(plain(r.lastFrame())).toContain('Enter answers')
    r.stdin.write('2') // picks, does not answer
    await tick()
    expect(api.decide).not.toHaveBeenCalled()
    r.stdin.write('\r')
    await tick()
    expect(api.decide).toHaveBeenCalledWith('a1', 'req-1', 'deny')
    // another agent finishing while this one is shown: attention and bell
    store.byId.set('a9', {
      ...worker,
      agent: { ...worker.agent, id: 'a9', name: 'other' },
      status: { ...worker.status, state: 'working' },
    })
    emit({
      type: 'agent.state',
      agentId: 'a9',
      projectId: 'p1',
      status: { ...worker.status, state: 'idle' },
    })
    expect(bell).toHaveBeenCalled()
    expect(store.attention.has('a9')).toBe(true)
  })

  it('refuses a small terminal and creates an agent from the agents screen', async () => {
    const { store, api } = scripted()
    const small = render(<App store={store} size={{ columns: 60, rows: 20 }} />)
    expect(plain(small.lastFrame())).toContain('at least 80×24')
    small.unmount()
    const r = render(<App store={store} size={{ columns: 100, rows: 30 }} />)
    store.start()
    await tick()
    r.stdin.write('\r')
    await tick()
    r.stdin.write('\x0e') // Ctrl+N
    await tick(40)
    expect(plain(r.lastFrame())).toContain('New agent in demo')
    r.stdin.write('helper')
    await tick()
    r.stdin.write('\r')
    await tick(40)
    expect(api.createAgent).toHaveBeenCalledWith('p1', { name: 'helper', profile: 'fake' })
    expect(plain(r.lastFrame())).toContain('helper')
  })
})
