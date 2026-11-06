#!/usr/bin/env bash
# Returns to the previous observer. BNB sales then stay syncing again.
set -euo pipefail
test "$(hostname)" = yunipals-main
rm -f /etc/systemd/system/yunipals-indexer-observer.service.d/90-finality-coverage.conf
systemctl daemon-reload
systemctl restart yunipals-indexer-observer.service
