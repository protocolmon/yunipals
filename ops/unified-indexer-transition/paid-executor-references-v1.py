#!/usr/bin/env python3
"""Reuse the accepted persistent metadata references for exact v4/v5 timers."""
from pathlib import Path
import ctypes
import re

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
SYSTEMD=Path('/etc/systemd/system')
PARENT_SHA='b9d018d495f70922ac8c63cff9b5b7c3e63c47f961640fee2ed80fc09822ea83'


def fail(code):raise RuntimeError(code)


def references(q,plan_sha,rows,*,family):
    if family not in {'productive_v4','productive_v5'} or not re.fullmatch('[0-9a-f]{64}',plan_sha):fail('exact_timer_reference_family_required')
    parent=q.load(OPS/'paid-productive-handoff-continue-v1.py',PARENT_SHA,'accepted_executor_reference_implementation')
    class ExactPair(parent.OldExecutorReferences):
        def __init__(self):
            self.q=q;self.rows=rows;self.sha=plan_sha;self.units=[];self.held=[];self.bus=ctypes.c_void_p();self.lib=None;self.started=None
            if len(rows)!=2 or {r.get('kind')for r in rows}!={'deadline','utc'}:fail('exact_two_owned_timer_metadata_refs_required')
            for row in rows:
                prefix='yunipals-paid-'+family.replace('_','-')+'-'+row['kind']+'-'+plan_sha[:16]
                if (row.get('timerUnit')!=prefix+'.timer' or row.get('serviceUnit')!=prefix+'.service' or
                    set(row.get('definitions',{}))!={str(SYSTEMD/(prefix+'.timer')),str(SYSTEMD/(prefix+'.service'))}):
                    fail('only_exact_current_or_parent_timer_refs_allowed')
                self.units.append(row['serviceUnit'])
            self.seal=q.sha(q.encoded(self.rows));self.check_files()
    return ExactPair()
