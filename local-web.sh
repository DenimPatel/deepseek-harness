#!/bin/sh
# Run the DeepSeek Harness built from *this* checkout on a non-default port.
# See LOCAL_BUILD.md for the full walkthrough.
#
#   ./local-web.sh          # port 3081
#   ./local-web.sh 3090     # custom port
#
# Uses an isolated $DSH_HOME so a second, packaged install can keep running
# from the default ~/.dsh without the two versions sharing state.
set -e

REPO="$(cd "$(dirname "$0")" && pwd)"
PORT="${1:-3081}"
export DSH_HOME="${DSH_HOME:-$HOME/.dsh-local}"

if [ ! -f "$REPO/apps/cli/lib/bin.js" ]; then
  echo "not built yet: run 'pnpm install && pnpm run build' in $REPO" >&2
  exit 1
fi

# Model provider credentials come from this environment. DEEPSEEK_API_KEY is
# the credential the deepseek-official route resolves; it lives in ~/.zshrc, so
# run this from an interactive terminal (a non-interactive shell does not read
# that file). Any other provider key, such as OPENROUTER_API_KEY, passes through
# the same way. Nothing is read from or written to any credentials file.
if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
  echo "warning: DEEPSEEK_API_KEY is unset; deepseek-official requests will fail" >&2
  echo "         until you export it or save a key in Settings -> Models." >&2
fi

echo "dsh (local build) -> DSH_HOME=$DSH_HOME port=$PORT"
exec node "$REPO/apps/cli/lib/bin.js" web --port "$PORT" --no-open
