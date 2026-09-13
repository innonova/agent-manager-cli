import { Box, Text, useInput } from 'ink'
import { useEffect, useRef, useState } from 'react'
import { clock, stateMark } from '../render.js'
import type { Store } from './store.js'
import { useStore } from './use-store.js'
import { Composer } from './Composer.tsx'
import { Transcript, transcriptLines } from './Transcript.tsx'
import type { StoredItem } from '../types.js'

export interface ChatProps {
  store: Store
  agentId: string
  width: number
  height: number
  focus: boolean
  onBack: () => void
}

/** The pending permission, focused: arrows or a number pick, Enter answers, Esc returns to the composer. */
function Permission({
  item,
  focus,
  onAnswer,
}: {
  item: Extract<StoredItem['item'], { kind: 'permission' }>
  focus: boolean
  onAnswer: (option: string) => void
}) {
  const [cursor, setCursor] = useState(0)
  useInput(
    (input, key) => {
      if (key.upArrow || key.leftArrow) setCursor((c) => Math.max(0, c - 1))
      else if (key.downArrow || key.rightArrow)
        setCursor((c) => Math.min(item.options.length - 1, c + 1))
      else if (/^[1-9]$/.test(input) && item.options[Number(input) - 1])
        setCursor(Number(input) - 1) // a digit picks; only Enter answers, so a stray key cannot allow
      else if (key.return && item.options[cursor]) onAnswer(item.options[cursor]!.id)
    },
    { isActive: focus },
  )
  const input = item.input !== undefined && item.input !== null ? JSON.stringify(item.input) : ''
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
      <Text color="magenta" bold>
        ? {item.title || item.tool}
      </Text>
      {input ? (
        <Text dimColor wrap="truncate-end">
          {input}
        </Text>
      ) : null}
      <Text>
        {item.options.map((o, i) => (
          <Text
            key={o.id}
            inverse={focus && i === cursor}
            color={o.kind === 'deny' ? 'red' : 'green'}
          >
            {` ${i + 1} ${o.label || o.id} `}
          </Text>
        ))}
        <Text dimColor>{focus ? '  Enter answers · Esc back to typing' : '  Tab to answer'}</Text>
      </Text>
    </Box>
  )
}

export function Chat({ store, agentId, width, height, focus, onBack }: ChatProps) {
  useStore(store)
  const row = store.byId.get(agentId)
  const t = store.transcripts.get(agentId)
  const items = t?.items ?? []
  const pending = store.pending(agentId)
  const perm = pending?.item.kind === 'permission' ? pending.item : null
  const [text, setTextState] = useState(store.drafts.get(agentId) ?? '')
  const setText = (v: string) => {
    setTextState(v)
    store.drafts.set(agentId, v)
  }
  const [scrollBack, setScrollBack] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [permFocus, setPermFocus] = useState(false)
  const lastTyping = useRef(0)
  const lastPending = useRef<string | null>(null)

  // a new permission takes the focus; an answered one gives it back
  useEffect(() => {
    const id = pending?.item.kind === 'permission' ? pending.item.requestId : null
    if (id && id !== lastPending.current) setPermFocus(true)
    if (!id) setPermFocus(false)
    lastPending.current = id
  }, [pending])

  const inner = Math.max(10, width - 4) // the composer's box takes border and padding
  const composerRows = Math.min(
    6,
    Math.max(
      1,
      text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / inner)), 0),
    ),
  )
  const permissionRows = perm ? 4 + (perm.input !== undefined && perm.input !== null ? 1 : 0) : 0
  const chrome =
    2 /* header */ + composerRows + 2 /* composer border */ + 1 /* footer */ + permissionRows
  const viewHeight = Math.max(3, height - chrome)
  const totalLines = transcriptLines(items, width - 2, expanded).length

  useInput(
    (input, key) => {
      if (key.escape) {
        if (permFocus) setPermFocus(false)
        else onBack()
        return
      }
      if (key.tab) {
        if (pending) setPermFocus((f) => !f)
        else setExpanded((e) => !e)
        return
      }
      if (key.pageUp) {
        const max = Math.max(0, totalLines - viewHeight)
        setScrollBack((s) => {
          const next = Math.min(max, s + viewHeight - 2)
          if (next >= max && store.hasEarlier(agentId)) void store.loadEarlier(agentId)
          return next
        })
        return
      }
      if (key.pageDown) return setScrollBack((s) => Math.max(0, s - (viewHeight - 2)))
      if (key.end) return setScrollBack(0)
      if (key.ctrl && input === 'x') {
        void store.interrupt(agentId).then((r) => r && store.say('interrupt sent'))
        return
      }
      if (key.ctrl && input === 's') {
        void store
          .stop(agentId)
          .then((r) => r && store.say('session stopped; the next turn resumes it'))
        return
      }
      if (key.ctrl && input === 'e') return setExpanded((e) => !e)
    },
    { isActive: focus },
  )

  const send = (v: string) => {
    setText('')
    setScrollBack(0)
    const steer = row?.status.state === 'working'
    void store.turn(agentId, v, steer).then((r) => {
      if (r === undefined)
        setTextState((cur) => {
          // refused: keep what was typed, unless something new is there already
          const next = cur === '' ? v : cur
          store.drafts.set(agentId, next)
          return next
        })
      else if (r.mode === 'queued')
        store.say('the agent cannot take a message mid-turn; queued for when it finishes')
      else if (r.mode === 'steered') store.say("steered: seen at the agent's next step")
    })
  }
  const onChange = (v: string) => {
    setText(v)
    const now = Date.now()
    if (now - lastTyping.current > 2000) {
      lastTyping.current = now
      store.typing(agentId)
    }
  }
  const others = (store.presence[agentId] ?? []).filter((u) => u.name !== store.user)
  const status = row?.status
  const state = status?.state ?? '…'
  const headerBits = [
    `${stateMark(state)} ${state}`,
    status?.model ?? '',
    status?.background ? `${status.background} background` : '',
    status?.queued ? `${status.queued} queued` : '',
    status?.usage
      ? [
          ...status.usage.windows.map((w) => `${w.name} ${w.usedPercent}%`),
          ...(status.usage.context
            ? [
                `ctx ${Math.round((100 * status.usage.context.used) / Math.max(1, status.usage.context.size))}%`,
              ]
            : []),
          ...((status.usage.total ?? status.usage.spend) && status.usage.windows.length === 0
            ? [
                (() => {
                  // the vendor's counter starts over at a restart: the total is the agent's
                  const s = (status.usage.total ?? status.usage.spend)!
                  return s.costUsd !== undefined
                    ? `$${s.costUsd.toFixed(2)}`
                    : `${Math.round((s.inputTokens + s.outputTokens) / 1000)}k tok`
                })(),
              ]
            : []),
        ].join(' · ')
      : '',
    status?.error ? `error: ${status.error}` : '',
    others.length
      ? `here: ${others.map((u) => u.name + (u.typing ? ' (typing…)' : '')).join(', ')}`
      : '',
    store.daemon ? '' : 'daemon disconnected',
    store.connected ? '' : 'reconnecting…',
  ].filter(Boolean)
  const last = status?.lastActivityAt ? clock(status.lastActivityAt) : ''
  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box>
        <Text bold>{row?.agent.name ?? agentId}</Text>
        <Text dimColor>
          {' '}
          {row?.agent.profile}
          {row?.agent.permissions === 'ask' ? ' · asks' : ''} {last}
        </Text>
      </Box>
      <Text wrap="truncate-end">{headerBits.join('  ')}</Text>
      <Transcript
        items={items}
        width={width - 2}
        height={viewHeight}
        scrollBack={scrollBack}
        expanded={expanded}
        hasEarlier={store.hasEarlier(agentId)}
        loadingEarlier={t?.loading ?? false}
      />
      {perm ? (
        <Permission
          item={perm}
          focus={focus && permFocus}
          onAnswer={(option) => {
            setPermFocus(false)
            void store.decide(agentId, perm.requestId, option)
          }}
        />
      ) : null}
      <Box borderStyle="round" borderColor={focus && !permFocus ? 'blue' : 'gray'} paddingX={1}>
        <Composer
          value={text}
          onChange={onChange}
          onSubmit={send}
          focus={focus && !permFocus}
          placeholder={
            state === 'working'
              ? 'working; Enter steers (seen at its next step)'
              : 'Enter sends, Shift+Enter or Ctrl+J newline'
          }
        />
      </Box>
      <Text dimColor wrap="truncate-end">
        {store.notice ??
          'Esc back · PgUp/PgDn scroll · Tab expand tools · Ctrl+X interrupt · Ctrl+S stop · Ctrl+F features · Ctrl+N new agent · Ctrl+C quit'}
      </Text>
    </Box>
  )
}
