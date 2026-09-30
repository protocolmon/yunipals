#!/usr/bin/env bash
set -Eeuo pipefail

if (( EUID != 0 )); then
  echo "Run as root on yunipals-main" >&2
  exit 1
fi

stage=/var/backups/yunipals-indexer-premerge-20260928TAduj0X/rehearsal/candidate-overrides
marker=/etc/yunipals-indexer/cutover-active
units=(
  yunipals-indexer
  yunipals-bnb
  yunipals-metadata
  yunipals-leaderboard
  yunipals-api
  yunipals-collector-api
  yunipals-market-monitor
)

for unit in "${units[@]}"; do
  installed="/etc/systemd/system/$unit.service.d/98-monorepo.conf"
  if [[ -e "$installed" ]] && ! cmp -s "$installed" "$stage/$unit.service.d/98-monorepo.conf"; then
    echo "Refusing to remove an unrecognized override: $installed" >&2
    exit 1
  fi
done

systemctl stop yunipals-market-monitor.timer
systemctl stop yunipals-market-monitor.service
systemctl stop yunipals-metadata.service yunipals-leaderboard.service
systemctl stop yunipals-indexer.service yunipals-bnb.service

for unit in "${units[@]}"; do
  rm -f "/etc/systemd/system/$unit.service.d/98-monorepo.conf"
done
systemctl daemon-reload

systemctl start yunipals-indexer.service yunipals-bnb.service
systemctl start yunipals-metadata.service yunipals-leaderboard.service
systemctl restart yunipals-api.service
systemctl restart yunipals-collector-api.service

for port in 9010 9011 9012; do
  ready=false
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 3 "http://127.0.0.1:$port/ready" >/dev/null; then
      ready=true
      break
    fi
    sleep 2
  done
  if [[ "$ready" != true ]]; then
    echo "Old release did not become ready on port $port" >&2
    exit 1
  fi
done

systemctl start yunipals-market-monitor.timer
rm -f "$marker"
echo "Restored the original six service definitions and monitor; production database retained"
