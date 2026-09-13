#!/usr/bin/env bash
# Builds and links `am` into ~/.local/bin so it is on the path of an SSH shell.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="${AGENT_MANAGER_CLI_BIN:-$HOME/.local/bin}"
cd "$ROOT"
npm run build >/dev/null
mkdir -p "$BIN"
cat > "$BIN/am" <<WRAP
#!/usr/bin/env bash
unset ELECTRON_RUN_AS_NODE
exec "$(command -v node)" "$ROOT/dist/main.js" "\$@"
WRAP
chmod +x "$BIN/am"
echo "installed $BIN/am -> $ROOT/dist/main.js"
