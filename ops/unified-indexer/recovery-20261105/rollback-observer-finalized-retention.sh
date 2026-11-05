#!/usr/bin/env bash
# Returns to observer v3. An older finalized answer from a provider fails observations again.
set -euo pipefail
test "$(hostname)" = yunipals-main
rm -f /etc/systemd/system/yunipals-indexer-observer.service.d/91-finalized-retention.conf
systemctl daemon-reload
systemctl restart yunipals-indexer-observer.service
