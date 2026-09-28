#!/usr/bin/env bash
# Switch the six production services only after the fresh Storage Box backup is verified.
set -Eeuo pipefail

if (( EUID != 0 )) || [[ $# != 1 ]]; then
  echo "Usage: sudo $0 /var/backups/yunipals-indexer-cutover-<timestamp>" >&2
  exit 2
fi

backup=$1
stage=/var/backups/yunipals-indexer-premerge-20260928TAduj0X/rehearsal/candidate-overrides
release=/opt/yunipals/releases/f0bd9a0/apps/yunipals-indexer
rollback=/opt/yunipals-indexer-ops/rollback-440da0e.sh
marker=/etc/yunipals-indexer/cutover-active
units=(yunipals-indexer yunipals-bnb yunipals-metadata yunipals-leaderboard yunipals-api yunipals-collector-api yunipals-market-monitor)
switchover_started=false

on_error() {
  local status=$?
  trap - ERR
  if [[ $switchover_started == true ]]; then
    echo "Cutover failed; attempting code rollback" >&2
    if ! bash "$rollback"; then
      echo "Automatic rollback failed; inspect systemd and run $rollback" >&2
    fi
  fi
  exit "$status"
}
trap on_error ERR

python3 - "$backup" <<'PY'
import hashlib, json, os, sys
from pathlib import Path

root = Path(sys.argv[1])
assert root.is_dir() and root.name.startswith("yunipals-indexer-cutover-"), "Invalid backup directory"
report = json.loads((root / "offhost-report.json").read_text())
manifest = json.loads((root / "manifest.json").read_text())
assert report["format"] == "yunipals-indexer-offhost-cutover-v1" and report["complete"] is True
assert manifest["format"] == "yunipals-indexer-cutover-backup-v1"
assert manifest["database"] == "yunipals_backfill" and manifest["release"] == "f0bd9a0"
assert set(manifest["files"]) == {"database.dump", "globals.sql", "recovery.tar.zst"}
for name, expected in manifest["files"].items():
    assert report["files"][name]["downloadDecryptionVerified"] is True
    assert report["files"][name]["plaintextSha256"] == expected["sha256"]
    path = root / name
    assert path.stat().st_size == expected["bytes"]
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    assert digest.hexdigest() == expected["sha256"], name
manifest_digest = hashlib.sha256((root / "manifest.json").read_bytes()).hexdigest()
assert report["files"]["manifest.json"]["downloadDecryptionVerified"] is True
assert report["files"]["manifest.json"]["plaintextSha256"] == manifest_digest
assert (root / "manifest.json.gpg").is_file()
assert os.stat(root).st_mode & 0o077 == 0, "Backup directory is not private"
print("Fresh local and off-host recovery files verified")
PY

[[ -d $release && -x $rollback && ! -e $marker ]]
[[ $(df -BG --output=avail / | tail -1 | tr -d ' G') -ge 25 ]]
! pg_lsclusters -h | awk '{print $2}' | grep -qx yunipals_indexer_rehearsal
sha256sum -c /etc/yunipals-indexer/ponder-runtime.sha256
for unit in "${units[@]}"; do
  [[ -f $stage/$unit.service.d/98-monorepo.conf ]]
  [[ ! -e /etc/systemd/system/$unit.service.d/98-monorepo.conf ]]
done
for unit in yunipals-indexer yunipals-bnb yunipals-metadata yunipals-leaderboard yunipals-api yunipals-collector-api; do
  systemctl is-active --quiet "$unit.service"
done
for port in 9010 9011 9012; do
  curl -fsS --max-time 5 "http://127.0.0.1:$port/ready" >/dev/null
done

record="$backup/production-cutover"
mkdir -m 700 "$record"
systemctl show "${units[@]/%/.service}" -p Id -p MainPID -p ExecStart -p ActiveState > "$record/services-before.txt"
runuser -u postgres -- psql -h /var/run/postgresql -p 5432 -d yunipals_backfill -At -v ON_ERROR_STOP=1 > "$record/database-before.txt" <<'SQL'
SELECT 'ponder_build|' || (value->>'build_id') FROM yunipals_indexer_v3._ponder_meta WHERE key='app';
SELECT 'bnb_cursor|' || last_scanned_block || '|' || last_scanned_hash FROM bnb_indexer.sync_state WHERE singleton;
SELECT 'metadata_release|' || release_id FROM metadata_source.archive_release WHERE state='active';
SQL
chmod 600 "$record"/*

switchover_started=true
systemctl stop yunipals-market-monitor.timer yunipals-market-monitor.service
systemctl stop yunipals-metadata.service yunipals-leaderboard.service
systemctl stop yunipals-indexer.service yunipals-bnb.service
for unit in yunipals-indexer yunipals-bnb yunipals-metadata yunipals-leaderboard; do
  [[ $(systemctl show "$unit.service" -p MainPID --value) == 0 ]]
  ! systemctl is-active --quiet "$unit.service"
done

for unit in "${units[@]}"; do
  install -D -m 644 "$stage/$unit.service.d/98-monorepo.conf" "/etc/systemd/system/$unit.service.d/98-monorepo.conf"
done
systemctl daemon-reload
install -m 600 /dev/null "$marker"
printf 'release=f0bd9a0\nbackup=%s\nstarted=%s\n' "$backup" "$(date -u +%FT%TZ)" > "$marker"

systemctl start yunipals-indexer.service yunipals-bnb.service
for _ in $(seq 1 90); do
  if curl -fsS --max-time 3 http://127.0.0.1:9010/ready >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS --max-time 5 http://127.0.0.1:9010/ready > "$record/ponder-ready.json"
for _ in $(seq 1 60); do
  locks=$(runuser -u postgres -- psql -h /var/run/postgresql -p 5432 -d yunipals_backfill -At -v ON_ERROR_STOP=1 <<'SQL'
SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
WHERE l.locktype='advisory' AND l.granted AND a.application_name='yunipals_bnb_writer:bnb_indexer';
SQL
)
  [[ $locks == 1 ]] && break
  sleep 2
done
[[ $locks == 1 ]]
systemctl is-active --quiet yunipals-bnb.service

systemctl start yunipals-metadata.service yunipals-leaderboard.service
systemctl restart yunipals-api.service
for _ in $(seq 1 60); do
  if curl -fsS --max-time 3 http://127.0.0.1:9011/ready >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS --max-time 5 http://127.0.0.1:9011/ready > "$record/api-ready.json"
systemctl restart yunipals-collector-api.service
for _ in $(seq 1 60); do
  if curl -fsS --max-time 3 http://127.0.0.1:9012/ready >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS --max-time 5 http://127.0.0.1:9012/ready > "$record/collector-ready.json"

for unit in yunipals-indexer yunipals-bnb yunipals-metadata yunipals-leaderboard yunipals-api yunipals-collector-api; do
  systemctl is-active --quiet "$unit.service"
  pid=$(systemctl show "$unit.service" -p MainPID --value)
  [[ $pid =~ ^[1-9][0-9]*$ ]]
  tr '\0' ' ' < "/proc/$pid/cmdline" | grep -F "$release/" >/dev/null
done
systemctl start yunipals-market-monitor.timer
systemctl show "${units[@]/%/.service}" -p Id -p MainPID -p ExecStart -p ActiveState > "$record/services-after.txt"
runuser -u postgres -- psql -h /var/run/postgresql -p 5432 -d yunipals_backfill -At -v ON_ERROR_STOP=1 > "$record/database-after.txt" <<'SQL'
SELECT 'ponder_build|' || (value->>'build_id') FROM yunipals_indexer_v3._ponder_meta WHERE key='app';
SELECT 'bnb_cursor|' || last_scanned_block || '|' || last_scanned_hash FROM bnb_indexer.sync_state WHERE singleton;
SELECT 'metadata_release|' || release_id FROM metadata_source.archive_release WHERE state='active';
SQL
chmod 600 "$record"/*
printf 'Cutover service switch complete; record: %s\n' "$record"
