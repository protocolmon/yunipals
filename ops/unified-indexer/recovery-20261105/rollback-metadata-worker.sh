#!/usr/bin/env bash
# Returns to the previous metadata worker. The URI audit has no time limit again.
set -euo pipefail
test "$(hostname)" = yunipals-main
rm -f /etc/systemd/system/yunipals-metadata.service.d/zzzzzzzzzzzzzzzzzzzzzzzzzzzz-audit-limit-20261105.conf
systemctl daemon-reload
systemctl restart yunipals-metadata.service
