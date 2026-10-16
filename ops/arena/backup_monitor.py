"""Fail the systemd health check if Arena backups or restore drills are overdue."""
import datetime
import json
import os
from pathlib import Path

from backup_policy import atomic_json


def check(state, now):
    reasons = []
    age = None
    success_path = state / 'latest-success.json'
    if success_path.exists():
        success = json.loads(success_path.read_text())
        age = (now - datetime.datetime.fromisoformat(success['createdAt'])).total_seconds()
        if age < 0 or age > 90 * 60:
            reasons.append('Backup snapshot is older than 90 minutes or its clock is invalid')
    else:
        reasons.append('No completed backup')
    attempt_path = state / 'latest-attempt.json'
    if attempt_path.exists() and json.loads(attempt_path.read_text())['status'] == 'failed':
        reasons.append('Latest backup attempt failed')
    drill_path = state / 'latest-restore-drill.json'
    if not drill_path.exists():
        reasons.append('No successful restore drill')
    else:
        drill = json.loads(drill_path.read_text())
        drill_age = (now - datetime.datetime.fromisoformat(drill['createdAt'])).total_seconds()
        if drill_age < 0 or drill_age > 9 * 86400:
            reasons.append('Restore drill is older than nine days or its clock is invalid')
    return {'status': 'healthy' if not reasons else 'needs-attention', 'checkedAt': now.isoformat(),
            'snapshotAgeSeconds': round(age) if age is not None else None,
            'maximumSnapshotAgeSeconds': 90 * 60, 'reasons': reasons,
            'notificationChannel': 'systemd failed units, journal and local health.json'}


if __name__ == '__main__':
    assert os.geteuid() == 0 and os.uname().nodename == 'yunipals-main'
    state = Path('/var/lib/yunipals-arena/backups')
    try:
        report = check(state, datetime.datetime.now(datetime.timezone.utc))
    except (OSError, ValueError, KeyError, TypeError):
        report = {'status': 'needs-attention', 'reasons': ['Backup health records are unreadable or invalid']}
    atomic_json(state / 'health.json', report)
    print(json.dumps(report))
    raise SystemExit(0 if report['status'] == 'healthy' else 1)
