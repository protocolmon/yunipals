#!/usr/bin/env bash
# Installs the indexer health monitor on yunipals-main from the current commit.
# Run from the repository root. This adds a permanent per-minute timer and sends
# one test email to the request monitor's recipient; set SKIP_TEST_EMAIL=1 when
# updating. BACKFILL_REORGS_SINCE=<date> imports older reorg records once. It also
# installs the read-only yunipals-reorg-report command. To remove it, see the end.
# Set YUNIPALS_INDEXER_SSH to the SSH destination of yunipals-main, for example
# root@<address>; the script checks the remote hostname before changing anything.
set -euo pipefail

host=${YUNIPALS_INDEXER_SSH:?Set YUNIPALS_INDEXER_SSH to the SSH destination of yunipals-main}
commit=$(git rev-parse HEAD)
release=/opt/yunipals-indexer-health-monitor/releases/$commit
app=apps/yunipals-indexer
unit=/etc/systemd/system/yunipals-indexer-health-monitor

if [[ -n "$(git status --porcelain -- "$app/scripts" "$app/deploy")" ]]; then
  echo 'Commit the monitor before installing, so the release matches a commit.' >&2
  exit 1
fi

ssh "$host" "test \"\$(hostname)\" = yunipals-main && mkdir -p '$release/scripts'"
scp -q "$app/scripts/indexer_health_monitor.py" "$app/scripts/request_monitor.py" \
  "$host:$release/scripts/"
scp -q "$app/deploy/indexer-health-monitor.json" \
  "$host:/etc/yunipals-indexer/indexer-health-monitor.json"
sed "s#@RELEASE_DIR@#$release#g" "$app/deploy/yunipals-indexer-health-monitor.service.template" |
  ssh "$host" "cat > '$unit.service'"
scp -q "$app/deploy/yunipals-indexer-health-monitor.timer" "$host:$unit.timer"

ssh "$host" "release='$release' unit='$unit' skip_test_email='${SKIP_TEST_EMAIL:-}' backfill_since='${BACKFILL_REORGS_SINCE:-}' bash -s" <<'REMOTE'
set -euo pipefail
test "$(hostname)" = yunipals-main
chown -R root:root /opt/yunipals-indexer-health-monitor
find /opt/yunipals-indexer-health-monitor -type d -exec chmod 755 {} +
chmod 644 "$release"/scripts/*.py "$unit.service" "$unit.timer"
chown root:root /etc/yunipals-indexer/indexer-health-monitor.json
chmod 600 /etc/yunipals-indexer/indexer-health-monitor.json
systemctl daemon-reload

echo 'First check:'
systemctl start yunipals-indexer-health-monitor.service
journalctl -u yunipals-indexer-health-monitor.service --since -1min --no-pager -o cat |
  grep -E '^\{' | tail -1 | cut -c1-300

printf '#!/bin/sh\nexec /usr/bin/python3 -B %s/scripts/indexer_health_monitor.py --reorg-report --state-dir /var/lib/yunipals-indexer-health-monitor\n' \
  "$release" > /usr/local/sbin/yunipals-reorg-report
chmod 0700 /usr/local/sbin/yunipals-reorg-report

if [[ -n "$backfill_since" ]]; then
  echo "Importing reorg records since $backfill_since:"
  systemd-run --wait --pipe --collect --quiet --uid=postgres --gid=postgres \
    -p SupplementaryGroups=systemd-journal \
    -p LoadCredential=monitor-config:/etc/yunipals-indexer/indexer-health-monitor.json \
    -p StateDirectory=yunipals-indexer-health-monitor -p WorkingDirectory="$release" \
    /bin/sh -c "/usr/bin/python3 -B '$release/scripts/indexer_health_monitor.py' \
      --config \"\$CREDENTIALS_DIRECTORY/monitor-config\" \
      --state-dir /var/lib/yunipals-indexer-health-monitor --backfill-reorgs '$backfill_since'"
fi

if [[ -z "$skip_test_email" ]]; then
echo 'Test email:'
systemd-run --wait --pipe --collect --quiet --uid=postgres --gid=postgres \
  -p EnvironmentFile=/etc/yunipals-indexer/request-monitor.env \
  -p LoadCredential=monitor-config:/etc/yunipals-indexer/indexer-health-monitor.json \
  -p LoadCredential=production-health:/var/lib/yunipals-unified-shared/production-health/latest.json \
  -p StateDirectory=yunipals-indexer-health-monitor \
  -p WorkingDirectory="$release" \
  /bin/sh -c "/usr/bin/python3 -B '$release/scripts/indexer_health_monitor.py' \
    --config \"\$CREDENTIALS_DIRECTORY/monitor-config\" \
    --production-health \"\$CREDENTIALS_DIRECTORY/production-health\" \
        --state-dir /var/lib/yunipals-indexer-health-monitor --test-email"
fi

systemctl enable --now yunipals-indexer-health-monitor.timer
systemctl list-timers yunipals-indexer-health-monitor.timer --no-pager --plain | sed -n 2p
REMOTE

# To remove it from yunipals-main:
#   systemctl disable --now yunipals-indexer-health-monitor.timer
#   rm /etc/systemd/system/yunipals-indexer-health-monitor.{service,timer}
#   rm /usr/local/sbin/yunipals-reorg-report
#   systemctl daemon-reload
