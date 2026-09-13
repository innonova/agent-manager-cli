# agent-manager-cli design

A terminal client for `agent-manager`, for the one situation the web UI
cannot cover: an SSH session to the box that allows no tunnels and no
software on the connecting side, such as a CyberArk or SSM mediated
shell. Claude Code works over that path, so this does too.

## Decisions

| Decision | Why |
|---|---|
| A client of the manager, never of the daemon | The manager owns the transcript cache and paging, attribution, permissions, presence and features. Going around it would duplicate all of that and drift. |
| Same machine, localhost by default | The client exists for the case where nothing but a shell reaches the box; a tunnel would make the browser work instead. The URL is configurable for tests, not for remote use. |
| Same accounts, same cookie | `POST /api/auth/login` with a user's password; the cookie is kept in `~/.config/agent-manager-cli/session.json`, mode 600. The manager accepts requests without an `Origin` header, so nothing in it changes for a non-browser client. |
| Node, Ink, React | The tools already on the box. Ink is the maintained full-screen framework for Node and what the agent CLIs themselves use. React is a second paradigm next to the Vue UI; the components here are small enough for that not to matter. |
| A decently sized terminal is required | Resizing a window is a small ask; degrading layouts are not worth their code. Under 80×24 the TUI says so and waits. |
| Plain commands first, the TUI on top | Every capability exists as a command that works in any terminal and in scripts (`am tail --follow` in one pane, `am turn` in another is a usable client on its own). The TUI is a view over the same client code. |
| Ported: projects, agents, chat, permissions, features | What is needed to give an agent work and read its answer. Not ported: files and diffs (the shell has an editor and git), users, display preferences. Drafts if missed. |

## Layout

- `src/config.ts`: where the login lives (`AGENT_MANAGER_CLI_CONFIG_DIR` overrides for tests; `AGENT_MANAGER_URL` overrides the manager).
- `src/api.ts`: the REST calls, one method per route, the same shapes as
  the web UI's client. `src/types.ts` mirrors the manager's models.
- `src/events.ts`: the websocket with reconnect and backoff; `presence`
  is the one frame sent upstream.
- `src/client.ts`: resolving what a person types: a project by id or
  name; an agent by id, `project/name`, or a name unique across projects.
- `src/render.ts`: one transcript item as a line of text (markdown
  through `marked-terminal`; tool calls folded to a name and their most
  telling argument; thinking dimmed to a marker unless `--full`).
- `src/commands.ts`: the plain commands and their usage text.
- `src/tui/`: the Ink application.

## Plain commands

`am login`, `logout`, `projects`, `agents <project>`, `new <project>
<name>`, `tail <agent>` (`--follow` streams, `--full` expands tool output
and thinking), `turn <agent> <text>`, `allow` / `deny <agent>`,
`interrupt`, `stop`, `features <project>`, `feature <project> <slug>`,
`respond <project> <slug> <text>`.

`turn`, `allow` and `deny` print the turn as it runs and return when it
ends, errors, or stops to ask a permission (`--no-wait` just sends).
`turn --steer` while a turn runs delivers the message into it, or queues
it for the next turn where the vendor cannot take one; the TUI's
composer does the same by itself while the agent works. A
streaming text item is printed once, when complete. Exit codes: 0, 1 for
a refused or failed request (the manager's message on stderr), 2 for
usage.

## TUI

`am` with no arguments. Three screens: projects, agents of a project,
and the chat; `Esc` goes back, `q` quits from the pickers, `Ctrl+C`
always. The chat screen:

- transcript: the last page from the manager, then live from the event
  stream; `PageUp`/`PageDown` scroll, and reaching the top loads the
  previous page; updates to an item (streaming text) replace it in
  place; tool calls fold to one line, `Tab` (or `Ctrl+E`) toggles
  expanding tool output and thinking, `End` jumps back to the newest;
- composer at the bottom: multi-line, `Enter` sends; `Shift+Enter`,
  `Alt+Enter` or `Ctrl+J` inserts a newline. Most terminals send a bare
  carriage return for Shift+Enter, indistinguishable from Enter, unless
  told to send a distinct sequence; the CSI u form (`ESC [13;2u`) and
  xterm's (`ESC [27;2;13~`) are both accepted, and the README shows the
  Windows Terminal binding. `Ctrl+J` works everywhere; typing reports
  presence;
- a pending permission takes focus above the composer: arrows or the
  option's number pick, only `Enter` answers (so a key typed as the
  prompt appears cannot allow anything), `Esc` returns to the composer
  with it still pending and `Tab` brings the focus back;
- `Ctrl+X` interrupts, `Ctrl+S` stops the session, `Ctrl+N` creates an
  agent (name, profile with `←`/`→`, ask or bypass with `Tab`), `Ctrl+F`
  opens the project's features (list, `Enter` reads, `r` responds:
  text, then a status with `←`/`→`, `Enter` sends);
- header: project and agent, state, model, who else is here and typing,
  the manager's daemon link; the terminal bell rings when a turn ends or
  a permission is asked while another agent is shown.

Nothing here is stored except the login; the composer text per agent,
scroll position and expansion live for the session. Vendor-provided text
(agent output, tool output) is stripped of every escape sequence but
colours and styles before it reaches the terminal.

## Testing

`npm run test:e2e` starts a real daemon (fake profile only) and manager on
ephemeral ports in a temporary directory (`test/backend.ts`, needs both
siblings built) and runs the commands in-process with captured output.
The TUI's components are tested with `ink-testing-library` against a
scripted client. Nothing in the tests touches the installed manager.
