# agent-manager-cli

`am`: a terminal client for [agent-manager](../agent-manager). Plain
commands for any shell and a chat TUI, so agents can be driven from an
SSH session when the browser cannot reach the manager (no tunnels, nothing
installable on the connecting side).

Installing the whole setup from scratch: `../agent-daemon/docs/install.md`.

```
npm install
npm run install:cli      # builds and links ~/.local/bin/am
am login                 # the same account as the web UI; asks for the password (or AGENT_MANAGER_PASSWORD in the environment)
am                       # the TUI
am help                  # the plain commands
```

`npm run install:cli` writes `~/.local/bin/am`, a wrapper that runs
`dist/main.js` from this checkout, so `~/.local/bin` must be on your
PATH and the checkout must stay where it is. The login is kept in
`~/.config/agent-manager-cli/session.json` (mode 600) and lasts as long
as the manager's session TTL (30 days by default). The manager is
`AGENT_MANAGER_URL` if set, else the URL given to `am login --url`, else
`http://127.0.0.1:4268`. `docs/design.md` has the decisions and the key
bindings.

## Newlines in the composer

`Enter` sends. `Ctrl+J` inserts a newline in any terminal. `Shift+Enter`
does too once the terminal sends a distinct sequence for it; most send a
plain Enter by default. In Windows Terminal add to `actions` in
settings.json:

```json
{ "command": { "action": "sendInput", "input": "\u001b[13;2u" }, "keys": "shift+enter" }
```

(`Alt+Enter` also works, but Windows Terminal uses it to maximise.)
