#!/usr/bin/env bash
set -euo pipefail
test "$(hostname)" = yunipals-main
rm -f /etc/systemd/system/yunipals-indexer.service.d/90-profiling.conf
systemctl daemon-reload
systemctl restart yunipals-indexer.service
