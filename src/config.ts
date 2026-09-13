import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const DEFAULT_URL = 'http://127.0.0.1:4268'

/** Where the login is kept: `$AGENT_MANAGER_CLI_CONFIG_DIR` (tests), else XDG config. */
export function configDir(): string {
  return (
    process.env.AGENT_MANAGER_CLI_CONFIG_DIR ??
    path.join(
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
      'agent-manager-cli',
    )
  )
}

export interface Session {
  url: string
  cookie: string
  user: string
}

const file = () => path.join(configDir(), 'session.json')

export function managerUrl(): string {
  return (process.env.AGENT_MANAGER_URL ?? loadSession()?.url ?? DEFAULT_URL).replace(/\/$/, '')
}

export function loadSession(): Session | null {
  try {
    const s = JSON.parse(fs.readFileSync(file(), 'utf8')) as Session
    return typeof s.cookie === 'string' && typeof s.url === 'string' ? s : null
  } catch {
    return null
  }
}

/** The cookie is a login: the file is readable by this user only. */
export function saveSession(s: Session): void {
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 })
  const tmp = `${file()}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 })
  fs.renameSync(tmp, file())
}

export function clearSession(): void {
  fs.rmSync(file(), { force: true })
}
