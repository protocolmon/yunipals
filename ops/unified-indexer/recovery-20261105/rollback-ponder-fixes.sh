#!/usr/bin/env bash
# Returns to the profiling-only release. This reintroduces both Ponder bugs.
set -euo pipefail
test "$(hostname)" = yunipals-main
rm -f /etc/systemd/system/yunipals-indexer.service.d/91-ponder-fixes.conf
systemctl daemon-reload
systemctl restart yunipals-indexer.service
