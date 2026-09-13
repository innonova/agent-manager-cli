---
title: terminal client with a chat TUI
status: review
priority: 50
---

A terminal client for the manager, for the case where the browser path
is unavailable: an SSH session mediated by CyberArk/SSM that allows no
tunnels and where nothing can be installed on the connecting PC. Claude
Code works over that path, so an Ink application will too.

Decided:

- runs on the same machine as the manager and daemon, talks to the
  manager over `127.0.0.1:4268` with the same REST and websocket API as
  the web UI, logs in with the same accounts and keeps the cookie in a
  mode-600 file; no manager changes beyond what the web UI needs;
- Node and Ink, so the tools are the ones already on the box;
- a decently sized terminal is required; the screen says so when it is
  too small rather than degrading;
- two layers: plain commands (`am login`, `projects`, `agents`, `tail`,
  `turn`, `allow`/`deny`, `interrupt`, `stop`, `new`, `features`) that
  work in any terminal and script, and the TUI (`am` alone) on top;
- the TUI ports, in order: project and agent picker with states and
  attention marks; the chat (transcript with tail and load-earlier
  paging, folded tool calls, dimmed thinking, timestamps, multi-line
  composer, interrupt, stop, new agent); permission prompts inline;
  features (list, read, respond); presence and typing.
- not ported: files, diffs, users, display preferences. Drafts later if
  missed.

## Report (2026-09-13)

Built in two stages, both in this repository, deployed as `~/.local/bin/am`.

Plain commands (`am help` lists them): `login`, `logout`, `projects`,
`agents`, `new`, `tail` (`--follow`, `--full`), `turn`, `allow`,
`deny`, `interrupt`, `stop`, `features`, `feature`, `respond`. Agents are
named by id, `project/name`, or a name unique across projects. `turn`,
`allow` and `deny` print the turn as it runs and return when it ends,
errors or stops to ask a permission. The login cookie is kept in
`~/.config/agent-manager-cli/session.json`, mode 600; the manager needed
no change (it already accepts requests without an Origin header).

The TUI (`am` alone): projects → agents → chat. The chat shows the last
200 items and loads earlier pages when you page up past the top, follows
live items, folds tool calls to one line (Tab expands tool output and
thinking), renders markdown, and has a multi-line composer (Enter sends,
Alt+Enter or Ctrl+J newline). A pending permission takes focus above the
composer: arrows or a number, Enter answers, Esc goes back to typing.
Ctrl+X interrupts, Ctrl+S stops, Ctrl+N creates an agent (name, profile,
ask/bypass), Ctrl+F opens the project's features (list, read, respond
with a status). The header shows state, model, background jobs, who else
is here or typing, and the daemon and connection state; the bell rings
when another agent finishes or asks, and the agents list marks it. Under
80×24 the screen asks for a bigger terminal.

Verified: e2e tests run the plain commands against a real daemon and
manager on ephemeral ports (login, agents, turn, tail, allow/deny, stop,
features, respond, logout); the TUI is tested with ink-testing-library
(composer editing, the full walk from projects to a sent turn, live
items and streaming updates, a permission answered by number, the bell
for another agent, the size check, creating an agent) and once end to
end in a pseudo-terminal (`script`) against the real backend, sending a
turn and seeing the answer. I could not try it over the CyberArk/SSM
path myself; that is yours to confirm.

Left open: drafts across agent switches; a scrollable list of who is
here beyond the header line; no `am` command creates a project (the web
UI or `curl` does); the transcript re-wraps on every render, which is
fine at 200 items and would want a smarter cache before larger pages.
