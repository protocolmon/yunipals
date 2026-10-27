#!/usr/bin/env bash
# One managed indexing service: native Ponder EVM ingestion and the Solana
# snapshot adapter. Node loads each child's private env file without sourcing it.
set -euo pipefail

indexer_node="${YUNIPALS_INDEXER_NODE:-node}"
"$indexer_node" -e 'if(Number(process.versions.node.split(".")[0])<24){console.error("Node 24 or newer is required.");process.exit(1)}'
ponder_env="${YUNIPALS_INDEXER_PONDER_ENV_FILE:?Configure the Ponder environment file}"
solana_enabled="${UNIFIED_SOLANA_ENABLED:-false}"
if [[ "$solana_enabled" != true && "$solana_enabled" != false ]]; then
  echo 'Invalid UNIFIED_SOLANA_ENABLED.' >&2
  exit 1
fi

ponder_directory="${YUNIPALS_INDEXER_PONDER_DIRECTORY:-$PWD}"
solana_directory="${YUNIPALS_INDEXER_SOLANA_DIRECTORY:-$PWD}"
if [[ "$ponder_directory" != /* || ! -d "$ponder_directory" || "$solana_directory" != /* || ! -d "$solana_directory" ]]; then
  echo 'Child working directories must be absolute existing directories.' >&2
  exit 1
fi
ponder_environment=(--env-file="$ponder_env")
for setting in YUNIPALS_INDEXER_PONDER_RUNTIME_ENV_FILE YUNIPALS_INDEXER_PONDER_OVERRIDE_ENV_FILE YUNIPALS_INDEXER_PONDER_REPLAY_ENV_FILE; do
  if [[ -v "$setting" ]]; then
    file="${!setting}"
    if [[ "$file" != /* || ! -r "$file" ]]; then
      echo 'Ponder overlay environment files must be absolute readable paths.' >&2
      exit 1
    fi
    ponder_environment+=(--env-file="$file")
  fi
done
if [[ -v DATABASE_URL || -v DATABASE_PRIVATE_URL || -v HELIUS_API_KEY ]]; then
  echo 'Keep database/provider credentials in the child environment files.' >&2
  exit 1
fi
if [[ "$ponder_env" != /* || ! -r "$ponder_env" ]]; then
  echo 'Ponder environment file must be an absolute readable path.' >&2
  exit 1
fi
if [[ "$solana_enabled" == true ]]; then
  solana_env="${YUNIPALS_INDEXER_SOLANA_ENV_FILE:?Configure the Solana environment file}"
  if [[ "$solana_env" != /* || ! -r "$solana_env" ]]; then
    echo 'Solana environment file must be an absolute readable path.' >&2
    exit 1
  fi
fi

# Retained deployments can pin the existing schema and loopback listener
# explicitly. Leaving these settings unset preserves the original CLI.
ponder_options=(--port "${UNIFIED_PONDER_PORT:-9010}")
if [[ -v UNIFIED_PONDER_SCHEMA ]]; then
  if [[ ! "$UNIFIED_PONDER_SCHEMA" =~ ^[a-zA-Z_][a-zA-Z0-9_]{0,44}$ || "$UNIFIED_PONDER_SCHEMA" == ponder_sync ]]; then
    echo 'Invalid UNIFIED_PONDER_SCHEMA.' >&2
    exit 1
  fi
  ponder_options+=(--schema "$UNIFIED_PONDER_SCHEMA")
fi
if [[ -v UNIFIED_PONDER_HOSTNAME ]]; then
  if [[ "$UNIFIED_PONDER_HOSTNAME" != 127.0.0.1 && "$UNIFIED_PONDER_HOSTNAME" != ::1 && "$UNIFIED_PONDER_HOSTNAME" != localhost ]]; then
    echo 'UNIFIED_PONDER_HOSTNAME must be loopback.' >&2
    exit 1
  fi
  ponder_options+=(--hostname "$UNIFIED_PONDER_HOSTNAME")
fi

children=()
stop_children() {
  trap '' TERM INT
  for child in "${children[@]}"; do kill -TERM "$child" 2>/dev/null || true; done
  for child in "${children[@]}"; do wait "$child" 2>/dev/null || true; done
}
trap 'stop_children; exit 0' TERM
trap 'stop_children; exit 130' INT

(
  cd "$ponder_directory"
  exec env UNIFIED_RPC_POLICY_REQUIRED=true "$indexer_node" --max-old-space-size=4096 "${ponder_environment[@]}" node_modules/ponder/dist/esm/bin/ponder.js start "${ponder_options[@]}"
) &
children+=("$!")
if [[ "$solana_enabled" == true ]]; then
  (
    cd "$solana_directory"
    exec "$indexer_node" --max-old-space-size=4096 --env-file="$solana_env" --import tsx lib/solana/worker.ts
  ) &
  children+=("$!")
fi

# A fatal child exit restarts the service as a unit. Transient Solana provider
# errors stay inside its bounded retry/scheduling loop and do not stop Ponder.
set +e
wait -n "${children[@]}"
status=$?
set -e
stop_children
if [[ "$status" == 0 ]]; then status=1; fi
exit "$status"
