#!/usr/bin/env python3
"""Root-operated Arena recovery; never signs transactions or loads provider keys."""
import argparse
import json
import os
from pathlib import Path
import pwd
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('command', choices=['plan', 'apply'])
parser.add_argument('name', help='Private incident name, letters/digits/hyphens only')
parser.add_argument('--max-blocks', type=int)
parser.add_argument('--sha256')
args = parser.parse_args()
if os.geteuid() != 0:
    parser.error('Run on yunipals-main as root; the database operation uses the isolated Arena owner role.')
if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9-]{0,63}', args.name):
    parser.error('Invalid incident name')
if args.command == 'plan' and (args.max_blocks is None or not 1 <= args.max_blocks <= 100000):
    parser.error('Plan requires --max-blocks between 1 and 100000; log ranges contain at most 500 blocks.')
if args.command == 'apply' and not re.fullmatch(r'[0-9a-f]{64}', args.sha256 or ''):
    parser.error('Apply requires --sha256 with the exact reviewed plan hash')

public = {}
for line in Path('/etc/yunipals-arena/runtime.env').read_text().splitlines():
    key, _, value = line.partition('=')
    if key in ['ARENA_CONTRACT', 'ARENA_DEPLOYMENT_BLOCK']:
        public[key] = value.strip().strip('\"\'')
if not re.fullmatch(r'0x[0-9a-fA-F]{40}', public.get('ARENA_CONTRACT', '')) or not public.get('ARENA_DEPLOYMENT_BLOCK', '').isdigit():
    raise SystemExit('Exact public deployment configuration is missing')

private = Path('/var/lib/yunipals-arena-recovery')
postgres = pwd.getpwnam('postgres')
if not private.exists():
    private.mkdir(mode=0o700)
    os.chown(private, postgres.pw_uid, postgres.pw_gid)
if private.is_symlink() or private.stat().st_uid != postgres.pw_uid or private.stat().st_mode & 0o077:
    raise SystemExit('Recovery directory must be private and owned by postgres')
bundle = Path(__file__).resolve().parent / 'arena-recovery.mjs'
if not bundle.is_file():
    raise SystemExit('The reviewed recovery bundle is missing')
invocation = [
    'runuser', '-u', 'postgres', '--', 'env',
    'ARENA_DATABASE_URL=postgresql:///yunipals_arena?host=/var/run/postgresql&port=15438',
    'PGOPTIONS=-c role=yunipals_arena_owner',
    *[key+'='+value for key,value in public.items()],
    '/srv/yunipals-arena/runtime/node-v24.18.1', str(bundle), args.command,
    str(private / (args.name+'.plan.json')),
    str(args.max_blocks) if args.command == 'plan' else args.sha256
]
if args.command == 'apply':
    invocation.append(str(private / (args.name+'.archive.json')))
result = subprocess.run(invocation, text=True, capture_output=True, timeout=1800)
if result.returncode:
    # Known operator errors only, never an unredacted pg/network exception or environment.
    known = [
        'Recovery requires an already halted deployment', 'Recovery scan exceeds its explicit RPC bound',
        'Recovery is blocked by unreconciled work', 'Recovery plan hash differs',
        'Live records changed', 'Canonical recovery head changed', 'The projector still owns its lock'
    ]
    error = next((message for message in known if message in result.stderr), 'Recovery failed; inspect the retained private plan and database state before retrying')
    print(json.dumps({'status':'refused','reason':error}))
    raise SystemExit(result.returncode)
print(result.stdout.strip())
