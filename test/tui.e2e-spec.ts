import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, it } from 'vitest'
import { ADMIN_PASSWORD, startBackend, type Backend } from './backend.js'
import { run, type Io } from '../src/commands.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let backend: Backend
let cfg: string
// oxlint-disable-next-line no-control-regex
const plain = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '')

beforeAll(async () => {
  backend = await startBackend()
  cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'am-cli-cfg-'))
  process.env.AGENT_MANAGER_CLI_CONFIG_DIR = cfg
  const io: Io = { out: () => undefined, err: (l) => console.error(l), ask: async () => '' }
  await run(['login', '--url', backend.url, '--name', 'admin', '--password', ADMIN_PASSWORD], io)
  const cookie = JSON.parse(fs.readFileSync(path.join(cfg, 'session.json'), 'utf8')).cookie
  await fetch(`${backend.url}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'demo', path: backend.projectDir, defaultProfile: 'fake' }),
  })
  await run(['new', 'demo', 'worker'], io)
})

afterAll(async () => {
  await backend?.stop()
  fs.rmSync(cfg, { recursive: true, force: true })
})

describe('the TUI in a pseudo-terminal', () => {
  it('starts, opens the agent, sends a turn and shows the answer', async () => {
    if (!fs.existsSync(path.join(ROOT, 'dist', 'main.js'))) throw new Error('build first')
    const proc = spawn(
      'script',
      ['-qfec', `stty cols 100 rows 30; node ${path.join(ROOT, 'dist', 'main.js')}`, '/dev/null'],
      {
        env: { ...process.env, AGENT_MANAGER_CLI_CONFIG_DIR: cfg, TERM: 'xterm-256color' },
        stdio: 'pipe',
      },
    )
    let out = ''
    proc.stdout.on('data', (d) => (out += d))
    const until = async (re: RegExp, ms = 8000) => {
      const t0 = Date.now()
      while (!re.test(plain(out))) {
        if (Date.now() - t0 > ms)
          throw new Error(`never saw ${re}; last output:\n${plain(out).slice(-1500)}`)
        await new Promise((r) => setTimeout(r, 50))
      }
    }
    try {
      await until(/demo/)
      proc.stdin.write('\r')
      await until(/worker/)
      proc.stdin.write('\r')
      await until(/type a turn/)
      proc.stdin.write('hello from the tui')
      await new Promise((r) => setTimeout(r, 100))
      proc.stdin.write('\r')
      await until(/You said: hello from the tui/)
      await until(/turn end/)
      proc.stdin.write('\x03') // Ctrl+C
      await new Promise((r) => setTimeout(r, 300))
    } finally {
      proc.kill('SIGKILL')
    }
  }, 30000)
})
