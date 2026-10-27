#!/usr/bin/env python3
"""Bounded exact-controller GC reference; no service jobs, signals or SQL.

Hold this one persistent systemd bus connection around the full existing unit
identity check. RefUnit is owned by the connection, unlike separate busctl calls.
"""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import time

FORMAT='yunipals-paid-controller-reference-v7'
SYSTEMD=Path('/etc/systemd/system')
TRANSIENT=Path('/run/systemd/transient')
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','TZ':'UTC'}
FAMILIES={'original_qualification':'yunipals-paid-capability-',
    'qualification_repair':'yunipals-paid-qualification-repair-',
    'qualification_repair_v2':'yunipals-paid-qualification-repair-v2-',
    'qualification_second_repair_v1':'yunipals-paid-qualification-second-repair-v1-',
    'qualification_second_repair_v2':'yunipals-paid-qualification-second-repair-v2-',
    'productive':'yunipals-paid-productive-controller-',
    'productive_v2':'yunipals-paid-productive-controller-v2-',
    'productive_v3':'yunipals-paid-productive-controller-v3-',
    'productive_v4':'yunipals-paid-productive-controller-v4-',
    'productive_v5':'yunipals-paid-productive-controller-v5-',
    'productive_v6':'yunipals-paid-productive-controller-v6-'}
SCRIPTS={'original_qualification':('paid-capability-live-v1.py','--admission-sha256'),
    'qualification_repair':('paid-qualification-repair-live-v1.py','--plan-sha256'),
    'qualification_repair_v2':('paid-qualification-repair-live-v2.py','--plan-sha256'),
    'qualification_second_repair_v1':('paid-qualification-second-repair-live-v1.py','--plan-sha256'),
    'qualification_second_repair_v2':('paid-qualification-second-repair-live-v2.py','--plan-sha256'),
    'productive':('paid-productive-live-v1.py','--plan-sha256'),
    'productive_v2':('paid-productive-live-v2.py','--plan-sha256'),
    'productive_v3':('paid-productive-live-v3.py','--plan-sha256'),
    'productive_v4':('paid-productive-live-v4.py','--plan-sha256'),
    'productive_v5':('paid-productive-live-v5.py','--plan-sha256'),
    'productive_v6':('paid-productive-live-v6.py','--plan-sha256')}


def fail(label):raise RuntimeError(label)
def sha(raw):return hashlib.sha256(raw).hexdigest()


def unit_name(kind,run_id):
    if kind not in FAMILIES or not isinstance(run_id,str)or not re.fullmatch('20261021-[a-z0-9-]{1,30}',run_id):fail('exact_owned_controller_family_and_run_required')
    if kind=='original_qualification'and run_id!='20261021-q1':fail('only_actual_finished_Q1_is_an_original_reference_target')
    return FAMILIES[kind]+run_id+'.service'


def definition_bytes(unit,expected):
    if (not isinstance(expected,dict)or set(expected)!={'path','sha256','dropInPaths'}or expected['dropInPaths']!=[]or
        expected['path']not in {str(SYSTEMD/unit),str(TRANSIENT/unit)}or not isinstance(expected['sha256'],str)or not re.fullmatch('[0-9a-f]{64}',expected['sha256'])):fail('exact_owned_controller_definition_binding_required')
    path=Path(expected['path'])
    for item in [*path.parents,path]:
        s=item.lstat()
        if stat.S_ISLNK(s.st_mode)or s.st_uid!=0 or s.st_mode&0o022:fail('protected_root_controller_definition_required')
    before=path.stat()
    if not stat.S_ISREG(before.st_mode)or before.st_size>50000:fail('bounded_controller_definition_required')
    raw=path.read_bytes();after=path.stat()
    if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns)or sha(raw)!=expected['sha256']:fail('owned_controller_definition_changed')
    return raw


def observe(unit):
    keys=['Id','LoadState','ActiveState','SubState','InvocationID','MainPID','FragmentPath','DropInPaths','ExecStart']
    result=subprocess.run(['/usr/bin/systemctl','show','--all',unit,*['--property='+key for key in keys]],env=ENV,capture_output=True,timeout=5)
    if result.returncode!=0 or len(result.stdout)>50000:fail('bounded_owned_controller_observation_required')
    fields={}
    for row in result.stdout.decode().splitlines():
        key,sep,value=row.partition('=')
        if not sep or key not in keys or key in fields:fail('unique_owned_controller_properties_required')
        fields[key]=value
    if set(fields)!=set(keys):fail('complete_owned_controller_properties_required')
    return fields


class ControllerReference:
    """Context manager for one pinned controller only; never starts/stops it."""
    def __init__(self,kind,run_id,definition,expected_argv,expected_invocation,*,maximum_seconds=30):
        self.unit=unit_name(kind,run_id)
        script,plan_option=SCRIPTS[kind]
        prefix='/usr/bin/python3 -B /opt/yunipals-unified/operations/free-replay-20261020/'+script+' --run-id '+run_id+' '+plan_option+' '
        if (not isinstance(expected_argv,str)or len(expected_argv)>10000 or '\n'in expected_argv or '\x00'in expected_argv or
            not re.fullmatch(re.escape(prefix)+'[0-9a-f]{64} --phase controller --apply [0-9a-f]{64}',expected_argv)or
            not isinstance(expected_invocation,str)or not re.fullmatch('[0-9a-f]{32}',expected_invocation)or
            type(maximum_seconds)is not int or not 1<=maximum_seconds<=60):fail('bounded_exact_controller_reference_inputs_required')
        # No arbitrary definition/input alias may change after construction.
        self.definition=json.loads(json.dumps(definition));self.argv=expected_argv;self.invocation=expected_invocation
        self.maximum=maximum_seconds;self.bus=ctypes.c_void_p();self.lib=None;self.referenced=False;self.started=None
        self._binding=self.binding()
        definition_bytes(self.unit,self.definition)
    def binding(self):return json.dumps([self.unit,self.definition,self.argv,self.invocation,self.maximum],sort_keys=True,separators=(',',':'))
    def _call(self,method):
        if method not in {'RefUnit','UnrefUnit'}:fail('controller_reference_is_not_job_control')
        reply=ctypes.c_void_p()
        try:
            value=self.lib.sd_bus_call_method(self.bus,b'org.freedesktop.systemd1',b'/org/freedesktop/systemd1',b'org.freedesktop.systemd1.Manager',method.encode(),None,ctypes.byref(reply),b's',ctypes.c_char_p(self.unit.encode()))
            if value<0:fail('exact_controller_reference_bus_call_failed')
        finally:
            if reply.value:self.lib.sd_bus_message_unref(reply)
    def acquire(self):
        if self.lib is not None:fail('controller_reference_cannot_be_reused')
        if self.binding()!=self._binding:fail('immutable_controller_reference_binding_required')
        definition_bytes(self.unit,self.definition);self.started=time.monotonic()
        self.lib=ctypes.CDLL('libsystemd.so.0')
        self.lib.sd_bus_open_system.argtypes=[ctypes.POINTER(ctypes.c_void_p)];self.lib.sd_bus_open_system.restype=ctypes.c_int
        self.lib.sd_bus_set_method_call_timeout.argtypes=[ctypes.c_void_p,ctypes.c_uint64];self.lib.sd_bus_set_method_call_timeout.restype=ctypes.c_int
        self.lib.sd_bus_call_method.restype=ctypes.c_int
        self.lib.sd_bus_call_method.argtypes=[ctypes.c_void_p,ctypes.c_char_p,ctypes.c_char_p,ctypes.c_char_p,ctypes.c_char_p,ctypes.c_void_p,ctypes.POINTER(ctypes.c_void_p),ctypes.c_char_p]
        self.lib.sd_bus_message_unref.argtypes=[ctypes.c_void_p];self.lib.sd_bus_message_unref.restype=ctypes.c_void_p
        self.lib.sd_bus_flush_close_unref.argtypes=[ctypes.c_void_p];self.lib.sd_bus_flush_close_unref.restype=ctypes.c_void_p
        try:
            if self.lib.sd_bus_open_system(ctypes.byref(self.bus))<0 or not self.bus.value:fail('owned_controller_system_bus_unavailable')
            if self.lib.sd_bus_set_method_call_timeout(self.bus,3_000_000)<0:fail('bounded_controller_reference_bus_timeout_required')
            self._call('RefUnit');self.referenced=True
            self.check()
            return self
        except BaseException:
            self.close();raise
    def check(self):
        if self.binding()!=self._binding:fail('immutable_controller_reference_binding_required')
        if not self.referenced or not self.bus.value or self.started is None or time.monotonic()-self.started>self.maximum:fail('live_bounded_controller_reference_required')
        definition_bytes(self.unit,self.definition);p=observe(self.unit)
        if (p['Id']!=self.unit or p['LoadState']!='loaded'or p['FragmentPath']!=self.definition['path']or p['DropInPaths']!=''or
            p['InvocationID']not in {'',self.invocation}or not p['MainPID'].isdigit()or
            re.findall(r'(?:^|[ {;])path=([^ ;]+)',p['ExecStart'])!=['/usr/bin/python3']or
            re.findall(r'argv\[\]=(.*?)\s+;',p['ExecStart'])!=[self.argv]or re.findall(r'(?:^|[ {;])ignore_errors=([^ ;]+)',p['ExecStart'])!=['no']):fail('referenced_controller_identity_or_selector_changed')
        if p['InvocationID']=='':
            if p['MainPID']!='0'or p['ActiveState']not in {'inactive','failed'}:fail('cleared_controller_invocation_requires_actual_stopped_state')
        elif p['MainPID']=='0':
            if p['ActiveState']not in {'inactive','failed'}:fail('referenced_controller_terminal_state_invalid')
        elif p['ActiveState']!='active'or p['SubState']!='running':fail('referenced_controller_running_state_invalid')
        return {'format':FORMAT,'unit':self.unit,'invocation':p['InvocationID'],'mainPid':int(p['MainPID']),
            'activeState':p['ActiveState'],'subState':p['SubState'],'definitionSha256':self.definition['sha256'],'referenceHeld':True,'jobControlPerformed':False}
    def close(self):
        error=None
        try:
            if self.referenced:
                try:self._call('UnrefUnit')
                except BaseException as exc:error=exc
                self.referenced=False
        finally:
            if self.lib is not None and self.bus.value:
                self.lib.sd_bus_flush_close_unref(self.bus);self.bus=ctypes.c_void_p()
        if error is not None:raise error
    def __enter__(self):return self.acquire()
    def __exit__(self,typ,value,traceback):
        try:
            if typ is None:self.check()
        finally:self.close()
