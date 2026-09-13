# agent-manager-cli

`am`: a terminal client for [agent-manager](../agent-manager). Plain
commands for any shell and a chat TUI, so agents can be driven from an
SSH session when the browser cannot reach the manager (no tunnels, nothing
installable on the connecting side).

```
npm install
npm run install:cli      # builds and links ~/.local/bin/am
am login                 # the same account as the web UI; asks for the password
am                       # the TUI
am help                  # the plain commands
```

The login is kept in `~/.config/agent-manager-cli/session.json` (mode
600). The manager is `http://127.0.0.1:4268` unless `AGENT_MANAGER_URL`
says otherwise. `docs/design.md` has the decisions and the key bindings.
