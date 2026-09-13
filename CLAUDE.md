# agent-manager-cli

Terminal client for `agent-manager` (`../agent-manager`, REST + websocket
on `127.0.0.1:4268`): plain commands plus an Ink chat TUI, so the agents
can be driven from a bare SSH shell when the browser path is unavailable.
`docs/design.md` is the source of truth; read it before changing
behaviour and update it when a decision changes.

## Rules that follow from the design

- A client of the manager only. Never talk to the daemon, never read the
  manager's database or the daemon's logs; everything comes through the
  manager's API, exactly as the web UI gets it.
- Runs on the manager's machine. The manager URL is configurable but the
  default is localhost, and nothing here should assume a tunnel.
- Every feature exists as a plain command before it exists in the TUI;
  the TUI is a view over the same client.
- No dependency the box does not already need, beyond Ink and React
  themselves, `ws`, `wrap-ansi` (which Ink brings anyway) and a markdown
  renderer.

## Stack and commands

Node 24, TypeScript, ESM (`.js` import suffixes), Ink 7 (React 19), `ws`,
vitest, oxlint + prettier.

```
npm run build          # tsc -> dist/
npm run dev -- <args>  # run from source
npm test               # unit tests
npm run test:e2e       # starts a real daemon (fake profile) and manager on ephemeral ports
npm run install:cli    # builds and links `am` into ~/.local/bin
npm run lint && npm run format
```

## Working here

- The sibling repositories are `../agent-daemon`, `../agent-manager` and
  `../agent-manager-ui`. The manager's API is in `../agent-manager/docs/design.md`.
- Never send turns to agents of the installed manager on 4268 from tests
  or experiments; that is the user's live workspace. The e2e harness
  starts its own daemon and manager.
- Prettier reformats aggressively; do not rely on exact-text matches of
  source you have not just read.

## Finishing work

Completed work is committed, pushed and deployed without asking first;
none of those needs approval, they need judgement. Complete means: does
what was asked, tests and lint pass, `docs/design.md` updated for a
behaviour change and `README.md` for an operator-facing one. Then commit
on `main`, push, deploy with `npm run install:cli` (it only rebuilds and
relinks `am`; nothing running is touched), and say so in the summary.
Still ask first for force-pushes, history rewrites, deleting branches,
anything that ends daemon sessions, and work beyond what was asked.

## You may be running inside this system

This repository is registered in the installed manager together with
its siblings; agents started from it work on this code. The installed
`agent-daemon` holds your own session: never restart it. Restarting the
installed manager is safe.

## Features

Units of work live in `features/<slug>.md` (frontmatter: title, status,
priority, dependsOn; body is the spec, followed by the conversation).
Nothing queues them: a human asks in the conversation. Set
`status: in-progress` when you start, append `## Report (YYYY-MM-DD)`
and set `status: review` when done (`blocked` with the reason if you
cannot continue), commit the file with the work, never edit the other
frontmatter fields, and do not create or edit feature files otherwise
unless asked. The convention is in `../agent-manager/docs/design.md`.
