import type { Io } from '../commands.js'

export async function tui(io: Io): Promise<number> {
  io.err('the TUI is not built yet; see `am help` for the plain commands')
  return 2
}
