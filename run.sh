#!/bin/sh
# aiprove-autonomous-agent — run the full autonomous loop.
#   ./run.sh              live mode (submits for real; needs a keypair)
#   ./run.sh --dry-run    full loop, no submissions posted
# Keypair: AIPROVE_AGENT_KEY_PATH (default ./agent-key.json) or
#          AIPROVE_AGENT_KEY (inline JSON or raw private key).
# --use-env-proxy is required on this machine (egress proxy); elsewhere
# plain `node agent.mjs` works.
set -e
cd "$(dirname "$0")"
exec node --use-env-proxy agent.mjs "$@"
