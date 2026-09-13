import { Box, Text, useInput } from 'ink'
import { useEffect, useMemo, useState } from 'react'
import wrapAnsi from 'wrap-ansi'
import { markdown, wrapText } from '../render.js'
import type { Feature, Project } from '../types.js'
import { Composer } from './Composer.tsx'
import { List } from './List.tsx'
import type { Store } from './store.js'
import { useStore } from './use-store.js'

const STATUSES = ['planned', 'done', 'blocked', 'review'] as const

/** The project's features: a list, a reader, and a response with a status. */
export function Features({
  store,
  project,
  width,
  height,
  focus,
  onBack,
}: {
  store: Store
  project: Project
  width: number
  height: number
  focus: boolean
  onBack: () => void
}) {
  useStore(store)
  const [open, setOpen] = useState<string | null>(null)
  const [mode, setMode] = useState<'read' | 'respond' | 'status'>('read')
  const [scroll, setScroll] = useState(0)
  const [text, setText] = useState('')
  const [statusIdx, setStatusIdx] = useState(0)
  const [sending, setSending] = useState(false)
  useEffect(() => {
    void store.loadFeatures(project.id)
  }, [store, project.id])
  const features = store.features.get(project.id) ?? []
  const feature = open ? features.find((f) => f.slug === open) : undefined
  const lines = useMemo(
    () =>
      feature
        ? wrapText(markdown(feature.body), width - 2, (t, w) =>
            wrapAnsi(t, w, { hard: true, trim: false }),
          )
        : [],
    [feature, width],
  )
  const bodyHeight = Math.max(3, height - (mode === 'read' ? 3 : 8))
  useInput(
    (input, key) => {
      if (mode === 'status') {
        if (key.escape) return setMode('respond')
        if (key.leftArrow || key.upArrow) return setStatusIdx((i) => Math.max(0, i - 1))
        if (key.rightArrow || key.downArrow)
          return setStatusIdx((i) => Math.min(STATUSES.length - 1, i + 1))
        if (key.return && feature && !sending) {
          setSending(true)
          void store.respond(project.id, feature.slug, text, STATUSES[statusIdx]).then((r) => {
            setSending(false)
            if (!r) return
            setText('')
            setMode('read')
            store.say(`responded; ${feature.slug} is ${STATUSES[statusIdx]}`)
          })
        }
        return
      }
      if (mode === 'respond') {
        if (key.escape) return setMode('read')
        return
      }
      if (key.escape) {
        if (open) setOpen(null)
        else onBack()
        return
      }
      if (!feature) return
      if (key.pageUp) return setScroll((s) => Math.max(0, s - bodyHeight))
      if (key.pageDown)
        return setScroll((s) => Math.min(Math.max(0, lines.length - bodyHeight), s + bodyHeight))
      if (input === 'r') return setMode('respond')
    },
    { isActive: focus },
  )
  if (!feature)
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Text bold>Features of {project.name}</Text>
        <List<Feature>
          items={features}
          focus={focus}
          height={height - 3}
          empty="no features"
          render={(f) => `${f.status.padEnd(11)} ${f.slug.padEnd(28)} ${f.title}`}
          onSelect={(f) => {
            setOpen(f.slug)
            setScroll(0)
            setMode('read')
          }}
        />
        <Text dimColor>{store.notice ?? 'Enter opens · Esc back'}</Text>
      </Box>
    )
  return (
    <Box flexDirection="column" width={width} height={height}>
      <Text bold>
        {feature.title}{' '}
        <Text dimColor>
          {feature.status} · {feature.path}
        </Text>
      </Text>
      <Box flexDirection="column" height={bodyHeight}>
        {lines.slice(scroll, scroll + bodyHeight).map((l, i) => (
          <Text key={scroll + i} wrap="truncate-end">
            {l === '' ? ' ' : l}
          </Text>
        ))}
      </Box>
      {mode === 'read' ? (
        <Text dimColor>{store.notice ?? 'PgUp/PgDn scroll · r respond · Esc back'}</Text>
      ) : (
        <Box flexDirection="column">
          <Box borderStyle="round" borderColor={mode === 'respond' ? 'blue' : 'gray'} paddingX={1}>
            <Composer
              value={text}
              onChange={setText}
              onSubmit={() => setMode('status')}
              focus={focus && mode === 'respond'}
              placeholder="your response; Enter continues to the status"
              maxRows={4}
            />
          </Box>
          <Text>
            status:{' '}
            {STATUSES.map((s, i) => (
              <Text key={s} inverse={mode === 'status' && i === statusIdx}>
                {` ${s} `}
              </Text>
            ))}
            <Text dimColor>
              {mode === 'status' ? '  ←/→ choose · Enter sends · Esc back' : '  (after the text)'}
            </Text>
          </Text>
        </Box>
      )}
    </Box>
  )
}
