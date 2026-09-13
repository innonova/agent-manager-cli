import { render } from 'ink'
import type { Io } from '../commands.js'
import { client } from '../client.js'
import { Events } from '../events.js'
import { App } from './App.tsx'
import { Store } from './store.js'

export async function tui(io: Io): Promise<number> {
  const api = client()
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    io.err('the TUI needs a terminal; see `am help` for the plain commands')
    return 2
  }
  const events = new Events(api.url, api.cookie!)
  const store = new Store(api, events)
  process.stdout.write('\x1b[?1049h\x1b[H') // alternate screen: the shell's scrollback stays clean
  const app = render(<App store={store} />, { exitOnCtrlC: true })
  store.start()
  try {
    await app.waitUntilExit()
  } finally {
    events.close()
    process.stdout.write('\x1b[?1049l')
  }
  return 0
}
