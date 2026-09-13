import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DAEMON_MAIN = path.resolve(ROOT, '..', 'agent-daemon', 'dist', 'main.js')
const MANAGER_MAIN = path.resolve(ROOT, '..', 'agent-manager', 'dist', 'main.js')
const FAKE_AGENT = path.resolve(ROOT, '..', 'agent-manager', 'fixtures', 'fake-agent.mjs')
export const ADMIN_PASSWORD = 'admin-e2e'

export interface Backend {
  url: string
  root: string
  projectDir: string
  stop: () => Promise<void>
}

/** A real daemon (fake profile only) and manager on ephemeral ports, in a temp dir. */
export async function startBackend(): Promise<Backend> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'am-cli-e2e-'))
  const daemonConfig = path.join(root, 'daemon-config')
  fs.mkdirSync(path.join(daemonConfig, 'profiles'), { recursive: true })
  fs.writeFileSync(
    path.join(daemonConfig, 'profiles', 'fake.json'),
    JSON.stringify({ command: process.execPath, args: [FAKE_AGENT], description: 'fake agent' }),
  )
  const projectDir = path.join(root, 'project')
  fs.mkdirSync(projectDir)
  fs.writeFileSync(path.join(projectDir, 'README.md'), '# demo\n')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const procs: ChildProcess[] = []
  const waitFor = (proc: ChildProcess, re: RegExp, what: string) =>
    new Promise<string>((resolve, reject) => {
      let log = ''
      const onData = (d: Buffer) => {
        log += d
        if (process.env.TEST_VERBOSE)
          process.stdout.write(String(d).replace(/^(?=.)/gm, `[${what}] `))
        const m = log.match(re)
        if (m) {
          clearTimeout(timer)
          resolve(m[1]!)
        }
      }
      proc.stdout!.on('data', onData)
      proc.stderr!.on('data', onData)
      proc.on('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`${what} exited early (${code})`))
      })
      const timer = setTimeout(() => {
        for (const p of procs) p.kill('SIGKILL')
        reject(new Error(`${what} did not start`))
      }, 20000)
      timer.unref()
    })
  const daemon = spawn(process.execPath, [DAEMON_MAIN], {
    env: {
      ...env,
      AGENT_DAEMON_LISTEN: '127.0.0.1:0',
      AGENT_DAEMON_CONFIG_DIR: daemonConfig,
      AGENT_DAEMON_STATE_DIR: path.join(root, 'daemon-state'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  procs.push(daemon)
  const daemonPort = await waitFor(daemon, /listening on ws:\/\/127\.0\.0\.1:(\d+)\//, 'daemon')
  const manager = spawn(process.execPath, [MANAGER_MAIN], {
    env: {
      ...env,
      AGENT_MANAGER_LISTEN: '127.0.0.1:0',
      AGENT_MANAGER_DAEMON_URL: `ws://127.0.0.1:${daemonPort}/`,
      AGENT_MANAGER_DATA_DIR: path.join(root, 'manager-data'),
      AGENT_MANAGER_ADMIN_PASSWORD: ADMIN_PASSWORD,
      AGENT_MANAGER_LOGIN_ATTEMPTS_PER_MINUTE: '1000',
      AGENT_MANAGER_UI_DIR: '',
      AGENT_MANAGER_EVENTS_PING_MS: '500',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  procs.push(manager)
  const port = await waitFor(manager, /listening on http:\/\/127\.0\.0\.1:(\d+)\//, 'manager')
  return {
    url: `http://127.0.0.1:${port}`,
    root,
    projectDir,
    stop: async () => {
      for (const p of procs.reverse()) p.kill('SIGTERM')
      await Promise.all(procs.map((p) => new Promise((r) => p.once('exit', r))))
      fs.rmSync(root, { recursive: true, force: true })
    },
  }
}
