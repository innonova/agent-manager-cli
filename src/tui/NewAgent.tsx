import { Box, Text, useInput } from 'ink'
import { useEffect, useState } from 'react'
import type { Store } from './store.js'
import { useStore } from './use-store.js'
import type { AgentRow, Project } from '../types.js'

export function NewAgent({
  store,
  project,
  focus,
  onDone,
}: {
  store: Store
  project: Project
  focus: boolean
  onDone: (row: AgentRow | null) => void
}) {
  useStore(store)
  const [name, setName] = useState('')
  const [profileIdx, setProfileIdx] = useState(-1)
  const [ask, setAsk] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!store.profiles.length) void store.loadProfiles()
  }, [store])
  const profiles = store.profiles
  const idx =
    profileIdx >= 0
      ? profileIdx
      : Math.max(
          0,
          profiles.findIndex((p) => p.name === project.defaultProfile),
        )
  const profile = profiles[idx]
  useInput(
    (input, key) => {
      if (busy) return
      if (key.escape) return onDone(null)
      if (key.leftArrow) return setProfileIdx(Math.max(0, idx - 1))
      if (key.rightArrow) return setProfileIdx(Math.min(profiles.length - 1, idx + 1))
      if (key.tab) return setAsk((a) => !a)
      if (key.backspace || key.delete) return setName((n) => n.slice(0, -1))
      if (key.return) {
        if (!name.trim() || !profile) return
        setBusy(true)
        void store
          .createAgent(project.id, {
            name: name.trim(),
            profile: profile.name,
            ...(ask ? { permissions: 'ask' as const } : {}),
          })
          .then((row) => {
            setBusy(false)
            if (row) onDone(row)
          })
        return
      }
      if (input && !key.ctrl && !key.meta) setName((n) => n + input.replace(/[\r\n]/g, ''))
    },
    { isActive: focus },
  )
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>New agent in {project.name}</Text>
      <Text>
        name: <Text inverse>{name || ' '}</Text>
      </Text>
      <Text>
        profile (←/→):{' '}
        {profiles.length
          ? profiles.map((p, i) => (i === idx ? `[${p.name}]` : ` ${p.name} `)).join('')
          : '…'}
      </Text>
      <Text>permissions (Tab): {ask ? '[ask]  bypass ' : ' ask  [bypass]'}</Text>
      <Text dimColor>{busy ? 'starting…' : (store.notice ?? 'Enter creates · Esc cancels')}</Text>
    </Box>
  )
}
