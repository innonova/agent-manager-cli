---
title: terminal client with a chat TUI
status: in-progress
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
