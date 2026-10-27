#!/usr/bin/env python3
"""Pinned v1 owner with a silent, explicitly absent libpq password-file path."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import types

OLD_FILE = Path('/opt/yunipals-unified/operations/free-replay-20261020/ypal-rpc-admission-v1.py')
OLD_SHA = 'd9e0cafdfcb817f7835d3856b920013a51b967defa17f239f76ee0416329093e'
NO_PASSWORD_FILE = '/run/yunipals-ypal-rpc-no-password-file'


def core():
    for p in [*OLD_FILE.parents, OLD_FILE]:
        s=p.lstat()
        if stat.S_ISLNK(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022:raise RuntimeError('exact_protected_v1_owner_required')
    before=OLD_FILE.stat();raw=OLD_FILE.read_bytes();after=OLD_FILE.stat()
    fields=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
    if not stat.S_ISREG(before.st_mode) or before.st_size>100000 or fields(before)!=fields(after) or hashlib.sha256(raw).hexdigest()!=OLD_SHA:raise RuntimeError('exact_frozen_v1_owner_required')
    m=types.ModuleType('ypal_rpc_v2_retained_owner');m.__file__=str(OLD_FILE)
    exec(compile(raw,str(OLD_FILE),'exec'),m.__dict__)
    m.__file__=str(Path(__file__).absolute())
    def query(sql):
        m.need(not os.path.lexists(NO_PASSWORD_FILE),'explicitly_absent_peer_password_file_required')
        opts='-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=12000'
        return json.loads(m.run([*m.peer(),'/usr/bin/env','-i','PATH=/usr/bin:/bin','LANG=C.UTF-8','TZ=UTC','PGPASSFILE='+NO_PASSWORD_FILE,'PGOPTIONS='+opts,'/usr/bin/psql','-XwAtq','-h','/var/run/postgresql','-p','15438','-U','postgres','-d','yunipals_market_production','-v','ON_ERROR_STOP=1'],('BEGIN READ ONLY; SET LOCAL search_path=pg_catalog;'+sql+';ROLLBACK;').encode()))
    m.query=query
    return m


def validate_current(pin):
    return core().validate_current(pin)


if __name__=='__main__':
    try:core().main()
    except Exception as e:
        print(json.dumps({'format':'yunipals-ypal-rpc-admission-v1','completed':False,'errorClass':type(e).__name__,'fixedCode':str(e) if type(e) is RuntimeError and re.fullmatch('[a-z_]+',str(e)) else 'private_diagnostics_withheld'}));raise SystemExit(1)
