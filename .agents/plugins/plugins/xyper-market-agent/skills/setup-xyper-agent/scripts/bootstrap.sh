#!/bin/sh
set -eu

install_node=0
dry_run=0

for arg in "$@"; do
  case "$arg" in
    --install-node) install_node=1 ;;
    --dry-run) dry_run=1 ;;
    *) echo "unknown_argument:$arg" >&2; exit 64 ;;
  esac
done

if [ "$(uname -s)" != "Darwin" ]; then
  echo "macos_required" >&2
  exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
state_dir=${XYPER_AGENT_HOME:-"$HOME/.xyper-market-agent"}
runtime_dir="$state_dir/runtime"
bundled_node="$runtime_dir/node-current/bin/node"

mkdir -p "$state_dir" "$runtime_dir"
chmod 700 "$state_dir" "$runtime_dir"

node_major() {
  "$1" --version 2>/dev/null | sed 's/^v//' | cut -d. -f1
}

find_node() {
  if [ -x "$bundled_node" ]; then
    printf '%s\n' "$bundled_node"
    return 0
  fi
  if command -v node >/dev/null 2>&1; then
    candidate=$(command -v node)
    major=$(node_major "$candidate")
    if [ -n "$major" ] && [ "$major" -ge 20 ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  fi
  return 1
}

install_portable_node() {
  case "$(uname -m)" in
    arm64) node_arch=arm64 ;;
    x86_64) node_arch=x64 ;;
    *) echo "unsupported_macos_architecture:$(uname -m)" >&2; exit 1 ;;
  esac

  tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/xyper-node.XXXXXX")
  trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM
  base_url="https://nodejs.org/dist/latest-v22.x"
  checksums="$tmp_dir/SHASUMS256.txt"

  /usr/bin/curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    "$base_url/SHASUMS256.txt" --output "$checksums"
  archive=$(/usr/bin/awk -v arch="$node_arch" \
    '$2 ~ ("^node-v[0-9.]+-darwin-" arch "\\.tar\\.gz$") { print $2; exit }' "$checksums")
  if [ -z "$archive" ]; then
    echo "node_archive_not_found:$node_arch" >&2
    exit 1
  fi

  expected=$(/usr/bin/awk -v file="$archive" '$2 == file { print $1; exit }' "$checksums")
  /usr/bin/curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    "$base_url/$archive" --output "$tmp_dir/$archive"
  actual=$(/usr/bin/shasum -a 256 "$tmp_dir/$archive" | /usr/bin/awk '{ print $1 }')
  if [ -z "$expected" ] || [ "$actual" != "$expected" ]; then
    echo "node_checksum_mismatch" >&2
    exit 1
  fi

  version_dir=${archive%.tar.gz}
  if [ ! -d "$runtime_dir/$version_dir" ]; then
    /usr/bin/tar -xzf "$tmp_dir/$archive" -C "$runtime_dir"
  fi
  ln -sfn "$version_dir" "$runtime_dir/node-current"
  chmod -R u+rwX,go-rwx "$runtime_dir/$version_dir"
}

if node_bin=$(find_node); then
  :
elif [ "$install_node" -eq 0 ]; then
  echo '{"status":"node_missing","required":"Node.js 20+","install":"local portable Node.js 22 LTS","nextAction":"Run ./bootstrap.sh --install-node after user approval."}'
  exit 2
else
  install_portable_node
  node_bin=$(find_node)
fi

npm_bin="$(dirname "$node_bin")/npm"
if [ ! -x "$npm_bin" ]; then
  if command -v npm >/dev/null 2>&1; then
    npm_bin=$(command -v npm)
  else
    echo "npm_not_found_for_node:$node_bin" >&2
    exit 1
  fi
fi

PATH="$(dirname "$node_bin"):$PATH"
export PATH

cd "$script_dir"
"$npm_bin" ci --no-fund --no-audit

if [ "$dry_run" -eq 1 ]; then
  "$node_bin" ./xyper_setup.mjs doctor --dry-run
  "$node_bin" ./xyper_setup.mjs setup --dry-run
else
  "$node_bin" ./xyper_setup.mjs doctor
fi

"$node_bin" -e 'console.log(JSON.stringify({status:"ready",nodeVersion:process.version,nodePath:process.execPath}))'
