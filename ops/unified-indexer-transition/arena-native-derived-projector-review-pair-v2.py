#!/usr/bin/env python3
"""Paired readonly review with actual absent-unit manager properties."""
import hashlib
import json
import os
from pathlib import Path
import stat
import types

FORMAT='yunipals-root-native-projector-paired-review-v2'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'arena-native-derived-projector-review-pair-v2.py'
FROZEN=OPS/'arena-native-derived-projector-review-pair-v1.py'
FROZEN_SHA='428805dc14b84a47caf88d151d32c161052b11d380949a5977b006d0027c26f6'
AUDIT=Path('/var/backups/yunipals-root-native-projector-paired-review-v2-20261025')
BASE=Path('/var/backups/yunipals-arena-native-derived-projector-v2-20261025')
PUBLIC=Path('/opt/yunipals-unified/arena-recovery-support/projector-v1-20261025')
UNIT='yunipals-arena-native-derived-projector-v1.service'
SOCKET_UNIT='yunipals-arena-native-derived-projector-v1.socket'
SOCKET=PUBLIC/'native-read.sock'


def need(value,code):
    if not value:raise RuntimeError(code)


def source():
    for path in[*FROZEN.parents,FROZEN]:
        row=path.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,
            'protected_frozen_paired_review_source_required')
    before=FROZEN.lstat();raw=FROZEN.read_bytes();after=FROZEN.lstat()
    need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and 0<len(raw)==before.st_size<100000 and
        hashlib.sha256(raw).hexdigest()==FROZEN_SHA and all(getattr(before,key)==getattr(after,key)for key in
            ['st_dev','st_ino','st_uid','st_gid','st_mode','st_size','st_mtime_ns','st_ctime_ns']),
        'exact_frozen_paired_review_source_required')
    return raw


def fields(raw,allowed,required):
    rows=[line.split('=',1)for line in raw.decode().splitlines()]
    need(all(len(row)==2 for row in rows)and len(rows)==len(dict(rows)),
        'unique_actual_absent_projector_manager_fields_required')
    value=dict(rows);need(required<=set(value)<=allowed,'exact_actual_absent_projector_property_set_required');return value


def absent(owner):
    need(owner.BASE==BASE and owner.PUBLIC==PUBLIC and owner.UNIT==UNIT and owner.SOCKET_UNIT==SOCKET_UNIT and owner.SOCKET==SOCKET,
        'actual_inherited_projector2_runtime_namespace_required')
    paths=[BASE,PUBLIC,Path('/etc/systemd/system')/UNIT,Path('/etc/systemd/system')/SOCKET_UNIT,SOCKET,
        *[Path('/sys/fs/cgroup/system.slice')/unit for unit in[UNIT,SOCKET_UNIT]]]
    need(not any(os.path.lexists(path)for path in paths),'projector_namespace_units_socket_and_cgroups_must_be_absent')
    keys=['Id','LoadState','ActiveState','SubState','FragmentPath','DropInPaths','Job'];result={}
    for unit in[UNIT,SOCKET_UNIT]:
        raw=owner.command(['/usr/bin/systemctl','show','--all',unit,*['--property='+key for key in keys]],timeout=15)
        frame=fields(raw,set(keys),set(keys))
        need(frame['Id']==unit and frame['LoadState']=='not-found'and frame['ActiveState']=='inactive'and
            frame['SubState']=='dead'and frame['Job']==frame['FragmentPath']==frame['DropInPaths']=='',
            'actual_generic_absent_projector_manager_frame_required')
        # A not-found service/socket may omit service-only PID properties.
        # Retain only actual returned fields; never fabricate zero PIDs.
        raw=owner.command(['/usr/bin/systemctl','show','--all',unit,'--property=MainPID','--property=ControlPID'],timeout=15)
        processes=fields(raw,{'MainPID','ControlPID'},set())
        need(all(value in{'','0'}for value in processes.values()),'any_actual_projector_process_property_must_be_empty_or_zero')
        result[unit]={'managerUnitAbsent':True,'frame':frame,'observedProcessFields':processes,
            'processFieldsInvented':False,'physicalCgroupAbsent':True}
    return result


def composition():
    value=types.ModuleType('actual_paired_review_v2');value.__file__=str(FILE)
    exec(compile(source(),str(FROZEN),'exec'),value.__dict__)
    value.FORMAT=FORMAT;value.AUDIT=AUDIT;value.absent=absent
    return value


if __name__=='__main__':
    import sys
    if len(sys.argv)==1:print(json.dumps({'format':FORMAT,'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
    else:composition().main()
