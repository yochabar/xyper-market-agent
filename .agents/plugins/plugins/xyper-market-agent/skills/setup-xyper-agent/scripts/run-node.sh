#!/bin/sh
set -eu

state_dir=${XYPER_AGENT_HOME:-"$HOME/.xyper-market-agent"}
bundled_node="$state_dir/runtime/node-current/bin/node"

node_major() {
  "$1" --version 2>/dev/null | sed 's/^v//' | cut -d. -f1
}

if [ -x "$bundled_node" ]; then
  node_bin=$bundled_node
elif command -v node >/dev/null 2>&1; then
  node_bin=$(command -v node)
  major=$(node_major "$node_bin")
  if [ -z "$major" ] || [ "$major" -lt 20 ]; then
    echo '{"status":"node_missing","required":"Node.js 20+","nextAction":"Run ./bootstrap.sh --install-node after user approval."}' >&2
    exit 2
  fi
else
  echo '{"status":"node_missing","required":"Node.js 20+","nextAction":"Run ./bootstrap.sh --install-node after user approval."}' >&2
  exit 2
fi

exec "$node_bin" "$@"
