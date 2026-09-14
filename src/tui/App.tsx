import { Box, Text, useApp, useInput, useStdout } from 'ink'
import { useEffect, useState } from 'react'
import { agentFacts, stateMark } from '../render.js'
import type { AgentRow, Project } from '../types.js'
import { Chat } from './Chat.tsx'
import { Features } from './Features.tsx'
import { List } from './List.tsx'
import { NewAgent } from './NewAgent.tsx'
import type { Store } from './store.js'
import { useStore } from './use-store.js'

export const MIN_COLS = 80
export const MIN_ROWS = 24

type Screen =
  | { name: 'projects' }
  | { name: 'agents'; project: Project }
  | { name: 'chat'; project: Project; agentId: string }
  | { name: 'new-agent'; project: Project; from: Screen }
  | { name: 'features'; project: Project; from: Screen }

export function App({ store, size }: { store: Store; size?: { columns: number; rows: number } }) {
  useStore(store)
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [dims, setDims] = useState(
    size ?? { columns: stdout.columns || 80, rows: stdout.rows || 24 },
  )
  useEffect(() => {
    if (size) return
    const onResize = () => setDims({ columns: stdout.columns || 80, rows: stdout.rows || 24 })
    stdout.on('resize', onResize)
    return () => void stdout.off('resize', onResize)
  }, [stdout, size])
  const [screen, setScreen] = useState<Screen>({ name: 'projects' })
  const width = dims.columns
  const height = dims.rows
  const tooSmall = width < MIN_COLS || height < MIN_ROWS

  const go = (s: Screen) => {
    if (s.name === 'chat') void store.open(s.agentId)
    else if (screen.name === 'chat') void store.open(null)
    if (s.name === 'agents') void store.loadAgents(s.project.id)
    setScreen(s)
  }

  useInput(
    (input, key) => {
      if (screen.name === 'projects' && input === 'q') exit()
      if (screen.name === 'agents') {
        if (input === 'q') exit()
        if (key.escape) go({ name: 'projects' })
      }
      if ((screen.name === 'agents' || screen.name === 'chat') && key.ctrl && input === 'n')
        go({ name: 'new-agent', project: screen.project, from: screen })
      if ((screen.name === 'agents' || screen.name === 'chat') && key.ctrl && input === 'f')
        go({ name: 'features', project: screen.project, from: screen })
    },
    { isActive: !tooSmall },
  )

  if (tooSmall)
    return (
      <Text>
        This needs a terminal of at least {MIN_COLS}×{MIN_ROWS}; this one is {width}×{height}.
        Resize it, or use the plain commands (am help). Ctrl+C quits.
      </Text>
    )

  const footer = (text: string) => <Text dimColor>{store.notice ?? text}</Text>

  switch (screen.name) {
    case 'projects':
      return (
        <Box flexDirection="column" width={width} height={height}>
          <Text bold>
            agent-manager{' '}
            <Text dimColor>
              {store.user ? `· ${store.user}` : ''}
              {store.connected ? '' : ' · connecting…'}
            </Text>
          </Text>
          <List
            items={store.projects}
            focus
            height={height - 3}
            empty="no projects yet (create one in the web UI)"
            render={({ project, agentCounts }) => {
              const counts = Object.entries(agentCounts)
                .filter(([, n]) => n)
                .map(([s, n]) => `${n} ${s}`)
                .join(', ')
              return `${project.name.padEnd(24)} ${counts}`
            }}
            onSelect={({ project }) => go({ name: 'agents', project })}
          />
          {footer('Enter opens · q quits')}
        </Box>
      )
    case 'agents': {
      const rows = store.agents.get(screen.project.id) ?? []
      return (
        <Box flexDirection="column" width={width} height={height}>
          <Text bold>
            {screen.project.name} <Text dimColor>· agents</Text>
          </Text>
          <List<AgentRow>
            items={rows}
            focus
            height={height - 3}
            empty="no agents yet (Ctrl+N creates one)"
            render={({ agent, status }) =>
              // the row is the agent's whole configuration: there is no editing, so this is where to check it
              `${stateMark(status.state)} ${store.attention.has(agent.id) ? '!' : ' '} ${agent.name.padEnd(20)} ${status.state.padEnd(19)} ${agentFacts(agent, status)}`
            }
            onSelect={({ agent }) =>
              go({ name: 'chat', project: screen.project, agentId: agent.id })
            }
          />
          {footer('Enter opens · Ctrl+N new agent · Ctrl+F features · Esc back · q quits')}
        </Box>
      )
    }
    case 'chat':
      return (
        <Chat
          store={store}
          agentId={screen.agentId}
          width={width}
          height={height}
          focus
          onBack={() => go({ name: 'agents', project: screen.project })}
        />
      )
    case 'new-agent':
      return (
        <Box flexDirection="column" width={width} height={height}>
          <NewAgent
            store={store}
            project={screen.project}
            focus
            onDone={(row) =>
              row
                ? go({ name: 'chat', project: screen.project, agentId: row.agent.id })
                : go(screen.from)
            }
          />
        </Box>
      )
    case 'features':
      return (
        <Features
          store={store}
          project={screen.project}
          width={width}
          height={height}
          focus
          onBack={() => go(screen.from)}
        />
      )
  }
}
