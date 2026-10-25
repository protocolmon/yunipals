#!/usr/bin/env python3
"""Same acknowledged ordinary source, live batched CAS; no effect entrypoints."""
import hashlib
import ast
import copy
import ipaddress
import functools
import traceback
import argparse
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import signal
import socket
import time
import types

FORMAT='yunipals-ypal-ordinary-source-authority-v4'
CAPTURE_BASE=Path('/var/backups/yunipals-ypal-ordinary-source-authority-v4-20261025/captures')
FAILURE_BASE=CAPTURE_BASE.parent/'failures'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
INTAKE=OPS/'ypal-alchemy-ordinary-consumer-context-v1.py'
INTAKE_SHA='5a1f4629899bed7ad498c84f016afa75cacbaf67663974d94c65453a84787986'
RUNTIME=OPS/'ypal-alchemy-ordinary-runtime-v1.py'
RUNTIME_SHA='3bf5811a6bc6163ede96e18ce57e9b0b45583889c15a639b79291d8c3be31be5'
READ=OPS/'ypal-ordinary-read-admission-v5b.py'
READ_SHA='a47d4f6b41839d3856244b7d08a92d3a8f56de71b8f566a22122bfb80f5213c3'
SOURCE='yunipals-ypal-combined-source.service'
FRESH='yunipals-booster-ypal-source.service'
CLEAN={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','TZ':'UTC'}
IDENTITY_FIELDS=('Id','LoadState','ActiveState','SubState','MainPID','ControlPID','InvocationID','ControlGroup','NRestarts','ExecMainStartTimestampMonotonic','FragmentPath','DropInPaths','EnvironmentFiles','ExecStart','WorkingDirectory','User','Group','Restart','UnitFileState','Job')
SET_FIELDS={'WantedBy','RequiredBy','Requires','Wants','Requisite','BindsTo','PartOf','Triggers','TriggeredBy','UpheldBy','OnFailure','OnSuccess','SystemCallArchitectures'}
SERVICE_FIELDS={'Environment','EnvironmentFiles','PassEnvironment','UnsetEnvironment','ExecStart','ExecStartPre','ExecStartPost','ExecStop','ExecStopPost','ExecReload','ExecCondition'}
UNIT_FIELDS={'Id','LoadState','ActiveState','SubState','InvocationID','ControlGroup','FragmentPath','DropInPaths','UnitFileState','WantedBy','RequiredBy','Requires','Wants','Requisite','BindsTo','PartOf','Triggers','TriggeredBy','UpheldBy','OnFailure','OnSuccess','Job'}


def need(ok,code):
    if not ok:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def pin(v):return type(v)is str and re.fullmatch('[a-f0-9]{64}',v)and v!='0'*64


class SourceComparisonMismatch(RuntimeError):
    def __init__(self,code,expected,actual):
        super().__init__(code);self.expected,self.actual=expected,actual


def equal_or_fail(code,expected,actual):
    if expected!=actual:raise SourceComparisonMismatch(code,expected,actual)


def changed_paths(before,after,path='$',limit=128):
    result=[]
    def walk(a,b,p):
        if len(result)>=limit:return
        if type(a)is not type(b):result.append(p);return
        if type(a)is dict:
            for key in sorted(set(a)|set(b)):
                q=p+'/'+str(key).replace('~','~0').replace('/','~1')
                if key not in a or key not in b:result.append(q)
                else:walk(a[key],b[key],q)
                if len(result)>=limit:return
        elif type(a)is list:
            if len(a)!=len(b):result.append(p+'/length')
            for index,(x,y)in enumerate(zip(a,b)):walk(x,y,p+'/'+str(index))
        elif a!=b:result.append(p)
    walk(before,after,path);return result[:limit]


def failure_directory(phase):
    need(re.fullmatch('[a-z_]+',phase),'fixed_source_failure_phase_required')
    for folder in[FAILURE_BASE.parent,FAILURE_BASE]:
        parent=folder.parent.lstat();need(stat.S_ISDIR(parent.st_mode)and parent.st_uid==parent.st_gid==0 and not parent.st_mode&0o022,'protected_private_source_failure_parent_required')
        try:
            folder.mkdir(mode=0o700)
            fd=os.open(folder.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
            try:os.fsync(fd)
            finally:os.close(fd)
        except FileExistsError:pass
        row=folder.lstat();need(stat.S_ISDIR(row.st_mode)and row.st_uid==row.st_gid==0 and stat.S_IMODE(row.st_mode)==0o700,'root_private_source_failure_directory_required')
    folder=FAILURE_BASE/(phase+'-'+str(time.time_ns())+'-'+str(os.getpid()));folder.mkdir(mode=0o700)
    fd=os.open(folder.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)
    return folder


def persist_failure(owner,phase,error):
    folder=failure_directory(phase);comparison=isinstance(error,SourceComparisonMismatch)
    trace={'format':FORMAT+'-private-exception','exceptionType':type(error).__name__,'exceptionString':str(error),
           'traceback':''.join(traceback.format_exception(type(error),error,error.__traceback__))}
    exclusive(folder/'exception.json',trace)
    summary={'format':FORMAT+'-failure','phase':phase,'operatorSha256':sha(Path(__file__).read_bytes()),
       'sourceResultSha256':getattr(owner,'result_sha',None),'sourceInputSha256':getattr(owner,'input_sha',None),
       'exceptionType':type(error).__name__,'comparisonFailure':comparison,'kernelAttempts':getattr(owner,'kernel_attempts',[]),
       'fixedCode':str(error)if isinstance(error,RuntimeError)and re.fullmatch('[a-zA-Z0-9_]+',str(error))else type(error).__name__,
       'databaseWrites':0,'serviceActions':0,'providerCalls':0,'authorityReturned':False}
    if comparison:
        summary['expectedSha256']=exclusive(folder/'expected.json',error.expected)
        summary['actualSha256']=exclusive(folder/'actual.json',error.actual)
        summary['changedPaths']=changed_paths(error.expected,error.actual)
    digest=exclusive(folder/'summary.json',summary)
    return {'summaryFile':str(folder/'summary.json'),'summarySha256':digest}


def audited_failure(function):
    @functools.wraps(function)
    def observed(self,*args,**kwargs):
        try:return function(self,*args,**kwargs)
        except BaseException as error:
            reference=getattr(error,'_ordinary_source_failure_audit',None)
            if reference is None:
                reference=persist_failure(self,function.__name__.strip('_')or'initialize',error)
                error._ordinary_source_failure_audit=reference
            self.last_failure_ref=reference
            raise
    return observed


def preflight_bookends(owner,first,final):
    equal_or_fail('full_preflight_source_binding_changed',first['binding'],final['binding'])
    equal_or_fail('full_preflight_batched_frame_changed',owner.expected,owner._snapshot())

def public(path,digest):
    for p in[*path.parents,path]:
        s=p.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode)and not s.st_mode&0o022,'protected_sameactor_authority_source_required')
    s=path.lstat();raw=path.read_bytes();a=path.lstat()
    need(stat.S_ISREG(s.st_mode)and s.st_nlink==1 and len(raw)<200000 and sha(raw)==digest and
         all(getattr(s,k)==getattr(a,k)for k in['st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns']),
         'exact_sameactor_authority_source_required');return raw

def module(path,digest):
    raw=public(path,digest);n=types.ModuleType(path.stem);n.__file__=str(path);exec(compile(raw,str(path),'exec'),n.__dict__);return n

def command(args,data=None,timeout=8):
    r=subprocess.run(args,input=data,env=CLEAN,capture_output=True,timeout=timeout)
    need(r.returncode==0 and not r.stderr and len(r.stdout)<=8000000,'bounded_live_sameactor_readonly_command_required');return r.stdout

def decode_all(raw):
    value=json.loads(raw)
    need(type(value)is dict and set(value)=={'type','data'}and value['type']=='a{sv}'and type(value['data'])is list and len(value['data'])==1 and type(value['data'][0])is dict,
         'actual_systemd_GetAll_dictionary_reply_required')
    result=value['data'][0]
    need(1<=len(result)<=1024 and all(type(k)is str and type(v)is dict and set(v)=={'type','data'}and type(v['type'])is str for k,v in result.items()),
         'bounded_typed_systemd_property_variants_required');return result

def state_batch(units):
    need(len(units)==11 and len(set(units))==11,'exact_source_fresh_and_nine_route_units_required')
    raw=command(['/usr/bin/systemctl','show','--all',*units,*['--property='+k for k in IDENTITY_FIELDS]])
    rows={};current={}
    for line in raw.decode().splitlines()+['']:
        if not line:
            if current:
                need(current.get('Id')in units and current['Id']not in rows,'one_manager_snapshot_per_fixed_unit_required');rows[current['Id']]=current;current={}
            continue
        k,sep,v=line.partition('=');need(sep and k in IDENTITY_FIELDS and (k not in current or k=='EnvironmentFiles'),'unique_fixed_manager_identity_fields_required')
        if k=='EnvironmentFiles':current.setdefault(k,[]).append(v)
        else:current[k]=v
    need(set(rows)==set(units),'all_eleven_live_manager_snapshots_required')
    for name,value in rows.items():
        if 'EnvironmentFiles'not in value and name in{SOURCE,FRESH}:
            # Actual systemctl --all omits this empty property for the two
            # Node --env-file source units. Require the real typed service
            # value; no absent/default/environment-order assumption is made.
            typed=properties(name)['Service'].get('EnvironmentFiles')
            need(type(typed)is dict and set(typed)=={'type','data'}and typed['type']=='a(sb)'and type(typed['data'])is list and typed['data']==[],
                 'missing_source_EnvironmentFiles_requires_actual_typed_empty_array')
            value['EnvironmentFiles']=[]
        need(set(value)==set(IDENTITY_FIELDS)and value['Id']==name and value['LoadState']=='loaded'and value['ActiveState']=='active'and value['SubState']=='running'and
             value['ControlPID']=='0'and value['Job']==''and re.fullmatch('[1-9][0-9]*',value['MainPID'])and re.fullmatch('[a-f0-9]{32}',value['InvocationID']),
             'all_same_acknowledged_source_and_route_units_must_be_running')
    return rows

def properties(unit):
    obj='/org/freedesktop/systemd1/unit/'+''.join(c if c.isalnum()else'_'+format(ord(c),'02x')for c in unit)
    return {name:decode_all(command(['/usr/bin/busctl','--system','--json=short','call','org.freedesktop.systemd1',obj,'org.freedesktop.DBus.Properties','GetAll','s','org.freedesktop.systemd1.'+name]))for name in['Unit','Service']}

def selected_properties(all_values,keys):
    result={}
    for key in keys:
        values=[row[key]for row in all_values.values()if key in row]
        need(values and all(value==values[0]for value in values),'every_qualified_security_runtime_property_must_exist_unambiguously')
        # Inline assignments can contain private values. Preserve their full
        # type/value digest, without retaining those values in the frame.
        value=copy.deepcopy(values[0])
        if key in SET_FIELDS:
            need(value['type']in{'as','ao'}and type(value['data'])is list and all(type(v)is str for v in value['data'])and len(set(value['data']))==len(value['data']),'actual_dependency_set_variant_required')
            value={'type':value['type'],'data':sorted(value['data'])}
        result[key]={'type':value['type'],'sha256':sha(encoded(value['data']))}if key=='Environment'else value
    return result


def paths_from(value):
    result=set()
    if type(value)is dict:
        for k,v in value.items():result|=paths_from(k)|paths_from(v)
    elif type(value)is list:
        for row in value:result|=paths_from(row)
    elif type(value)is str and value.startswith('/')and not value.startswith(('/proc/','/sys/')):
        p=Path(value)
        if value!='/'and '..'not in p.parts and '\0'not in value and len(value)<4096:result.add(value)
    return result

def activation_frame(units):
    result={};root=Path('/etc/systemd/system')
    for folder in sorted(root.iterdir()):
        if not folder.name.endswith(('.wants','.requires')):continue
        row=folder.lstat();need(stat.S_ISDIR(row.st_mode)and row.st_uid==0 and not row.st_mode&0o022,'protected_actual_activation_directory_required')
        for unit in units:
            path=folder/unit
            if os.path.lexists(path):
                row=path.lstat();need(stat.S_ISLNK(row.st_mode)and row.st_uid==0,'literal_owned_unit_activation_link_required')
                result[str(path)]={'target':os.readlink(path),'identity':{k:getattr(row,'st_'+k)for k in['dev','ino','mode','uid','gid','nlink']}}
    return result


def retired_frame(units):
    need(len(units)==12 and len(set(units))==12,'exact_twelve_recorded_retired_deadline_units_required')
    fields=('Id','LoadState','ActiveState','Job');rows={};current={}
    raw=command(['/usr/bin/systemctl','show','--all',*units,*['--property='+k for k in fields]])
    for line in raw.decode().splitlines()+['']:
        if not line:
            if current:
                name=current.get('Id');need(name in units and name not in rows and set(current)==set(fields),'one_complete_recorded_retired_unit_state_required')
                need(current['LoadState']in{'loaded','not-found'}and current['ActiveState']in{'inactive','failed'}and current['Job']=='','recorded_retired_deadlines_must_remain_terminal_and_jobless')
                group=Path('/sys/fs/cgroup/system.slice')/name/'cgroup.procs'
                need(not group.exists()or not group.read_text().split(),'retired_deadline_cgroup_must_remain_empty')
                if current['LoadState']=='not-found':need(not os.path.lexists(Path('/etc/systemd/system')/name),'not_found_retired_unit_must_have_no_definition')
                else:
                    obj='/org/freedesktop/systemd1/unit/'+''.join(c if c.isalnum()else'_'+format(ord(c),'02x')for c in name)
                    need(json.loads(command(['/usr/bin/busctl','--system','--json=short','get-property','org.freedesktop.systemd1',obj,'org.freedesktop.systemd1.Unit','Job']))=={'type':'(uo)','data':[0,'/']},'actual_retired_deadline_typed_empty_job_required')
                rows[name]=current;current={}
            continue
        k,sep,v=line.partition('=');need(sep and k in fields and k not in current,'unique_recorded_retired_unit_fields_required');current[k]=v
    need(set(rows)==set(units),'all_twelve_retired_deadlines_must_be_reobserved');return rows


def file_frame(paths):
    need(len(paths)<=2048,'finite_sameactor_static_private_file_set_required');rows={};total=0
    for name in sorted(paths):
        p=Path(name)
        try:s=p.lstat()
        except FileNotFoundError:rows[name]=None;continue
        identity={k:getattr(s,'st_'+k)for k in['dev','ino','mode','uid','gid','nlink']}
        if stat.S_ISLNK(s.st_mode):rows[name]={'identity':identity,'target':os.readlink(p)};continue
        if stat.S_ISDIR(s.st_mode):rows[name]={'identity':identity};continue
        need(stat.S_ISREG(s.st_mode)and s.st_nlink==1 and s.st_size<=200000000,'only_bounded_regular_proof_input_files_allowed')
        total+=s.st_size;need(total<=700000000,'bounded_total_sameactor_input_bytes_required')
        h=hashlib.sha256();fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
        try:
            before=os.fstat(fd)
            while True:
                raw=os.read(fd,1048576)
                if not raw:break
                h.update(raw)
            after=os.fstat(fd)
        finally:os.close(fd)
        need(all(getattr(s,k)==getattr(before,k)==getattr(after,k)==getattr(p.lstat(),k)for k in['st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns']),
             'sameactor_input_changed_during_hashing')
        rows[name]={'identity':identity,'sha256':h.hexdigest()}
    return rows

PROCESS_PEER=r'''import hashlib,json,os,pathlib,stat,sys
v=json.load(sys.stdin);assert type(v)is dict and set(v)=={'uid','gid','pids','sourcePid','mounts'}
assert os.geteuid()==v['uid'] and os.getegid()==v['gid'] and not os.getgroups()
s=dict(line.split(':',1)for line in pathlib.Path('/proc/self/status').read_text().splitlines()if':'in line)
assert s['NoNewPrivs'].strip()=='1' and all(int(s[k],16)==0 for k in ['CapInh','CapPrm','CapEff','CapBnd','CapAmb'])
assert 1<=len(v['pids'])<=32 and all(type(p)is int and p>0 for p in v['pids'])
h=lambda b:hashlib.sha256(b).hexdigest();rows={}
for pid in v['pids']:
 root=pathlib.Path('/proc')/str(pid);before=(root/'stat').read_bytes();tail=before.decode().rsplit(')',1)[1].split()
 status=dict(line.split(':',1)for line in(root/'status').read_text().splitlines()if':'in line)
 assert list(map(int,status['Uid'].split()))==[v['uid']]*4 and list(map(int,status['Gid'].split()))==[v['gid']]*4
 rows[str(pid)]={'pid':pid,'startTicks':int(tail[19]),'parentPid':int(tail[1]),'uid':status['Uid'].split(),'gid':status['Gid'].split(),'groups':sorted(map(int,status['Groups'].split())),
  'cgroup':(root/'cgroup').read_text().strip(),'privileges':{k:status[k].strip()for k in ['CapInh','CapPrm','CapEff','CapBnd','CapAmb','NoNewPrivs','Seccomp']},
  'argvSha256':h((root/'cmdline').read_bytes()),'environmentSha256':h((root/'environ').read_bytes()),'cwd':os.readlink(root/'cwd'),'executable':os.readlink(root/'exe')}
 assert(root/'stat').read_bytes().decode().rsplit(')',1)[1].split()[19]==str(rows[str(pid)]['startTicks'])
mounts={}
if v['sourcePid']is not None:
 assert v['sourcePid']in v['pids'] and len(v['mounts'])==6
 for inside,backing in v['mounts'].items():
  a=os.stat('/proc/'+str(v['sourcePid'])+'/root'+inside);b=os.stat(backing)
  f=lambda s:{'dev':s.st_dev,'ino':s.st_ino,'uid':s.st_uid,'gid':s.st_gid,'kind':stat.S_IFMT(s.st_mode)}
  assert f(a)==f(b);mounts[inside]=f(a)
 mounts['mountinfoSha256']=h(pathlib.Path('/proc',str(v['sourcePid']),'mountinfo').read_bytes())
print(json.dumps({'processes':rows,'mounts':mounts,'capabilitiesZero':True,'noNewPrivileges':True},sort_keys=True))
'''

def fixed_cgroup(unit):
    chains={'ethereum','base','polygon','bnb'}
    if unit in{SOURCE,FRESH,'yunipals-ypal-base-rpc.service'}:return '/system.slice/'+unit
    if unit in{'yunipals-combined-rpc@'+c+'.service'for c in chains}:
        return r'/system.slice/system-yunipals\x2dcombined\x2drpc.slice/'+unit
    if unit in{'yunipals-market-production-rpc@'+c+'.service'for c in chains}:
        return r'/system.slice/system-yunipals\x2dmarket\x2dproduction\x2drpc.slice/'+unit
    raise RuntimeError('only_exact_eleven_acknowledged_cgroup_units_allowed')


def kernel_cgroups(states,unit_pids,observations):
    actual={pid:row for peer in observations for pid,row in peer['processes'].items()}
    need(len(actual)==sum(len(peer['processes'])for peer in observations)and all(actual[str(pid)]['cgroup']=='0::'+states[unit]['ControlGroup']for unit,pids in unit_pids.items()for pid in pids),
         'every_actual_owned_PID_kernel_cgroup_must_match_typed_acknowledged_unit')
    return True


def process_frame(states,mounts):
    groups={};unit_pids={}
    for unit,row in states.items():
        group=row['ControlGroup'];need(group==fixed_cgroup(unit),'exact_fixed_source_and_proxy_cgroups_required')
        pids=sorted(map(int,(Path('/sys/fs/cgroup')/group.lstrip('/')/'cgroup.procs').read_text().split()))
        need(1<=len(pids)<=8 and int(row['MainPID'])in pids,'complete_bounded_owned_unit_process_tree_required');unit_pids[unit]=pids
        for pid in pids:
            status=dict(line.split(':',1)for line in Path('/proc',str(pid),'status').read_text().splitlines()if':'in line)
            uid=list(map(int,status['Uid'].split()));gid=list(map(int,status['Gid'].split()))
            need(len(set(uid))==len(set(gid))==1 and uid[0]>0 and gid[0]>0,'same_unprivileged_owned_source_and_RPC_accounts_required')
            groups.setdefault((uid[0],gid[0]),set()).add(pid)
    need(len(groups)<=4,'bounded_existing_source_and_proxy_UID_set_required')
    observations=[];source_pid=int(states[SOURCE]['MainPID'])
    for(uid,gid),pids in sorted(groups.items()):
        data={'uid':uid,'gid':gid,'pids':sorted(pids),'sourcePid':source_pid if source_pid in pids else None,'mounts':mounts if source_pid in pids else{}}
        observations.append(json.loads(command(['/usr/bin/setpriv','--reuid='+str(uid),'--regid='+str(gid),'--clear-groups','--inh-caps=-all','--ambient-caps=-all','--bounding-set=-all','--no-new-privs','--pdeathsig=KILL','/usr/bin/env','-i','/usr/bin/python3','-I','-B','-c',PROCESS_PEER],encoded(data))))
    kernel_cgroups(states,unit_pids,observations)
    return {'unitPids':unit_pids,'peers':observations}


def financial_current(owner):
    # Genuine immutable89a financial body, with only its constructor explicitly
    # supplied from the already authenticated ordinary owner. No old globals
    # are patched; all live snapshots/monotonic/immutable checks still run.
    original=owner.financial.validate_current
    need(not original.__code__.co_freevars,'no_hidden_financial_current_closure_allowed')
    fn=types.FunctionType(original.__code__,{**original.__globals__,'saved_owner':lambda:owner.fo},original.__name__,original.__defaults__)
    return fn(owner.config['financialReceiptSha256'])


def read_data_identity(target):
    # Same pure ACL-independent identity projection as the official creator's
    # data_current(). Permissions are checked separately by the full graph.
    return {k:([{key:v for key,v in row.items()if key!='acl'}for row in val]if k in{'relations','functions'}else val)
            for k,val in target.items()if k!='nonownerPermissions'}


HOST_KERNEL=OPS/'ypal-alchemy-source-switch-v1.host.py'
HOST_KERNEL_SHA='3b73d2f804c2c64f212c6b11eb3f108087a54af580baecb35ddffa2033dd4e02'


class KernelQueryChurn(RuntimeError):
    def __init__(self,before,after):
        super().__init__('classified_positive_complete_kernel_query_churn')
        self.before,self.after=before,after


def valid_final_source_rows(rows):
    if type(rows)is not list or len(rows)>32:return False
    ids=[]
    for row in rows:
        if not(type(row)is dict and set(row)=={'pid','backendStart','clientAddress','clientPort'}and type(row['pid'])is int and row['pid']>0 and
               type(row['backendStart'])is str and 0<len(row['backendStart'])<=256):return False
        address,port=row['clientAddress'],row['clientPort']
        if address is None:
            if port is not None and not(type(port)is int and port==-1):return False
        else:
            if type(address)is not str or not 1<=len(address)<=64 or type(port)is not int or not 1<=port<=65535:return False
            try:ipaddress.ip_address(address)
            except ValueError:return False
        ids.append(row['pid'])
    return len(ids)==len(set(ids))


def classified_kernel(host_module):
    raw=public(HOST_KERNEL,HOST_KERNEL_SHA);tree=ast.parse(raw)
    fn=copy.deepcopy(next(row for row in tree.body if isinstance(row,ast.FunctionDef)and row.name=='kernel_backends'))
    final=fn.body[-2]
    need(isinstance(final,ast.Expr)and isinstance(final.value,ast.Call)and ast.unparse(final.value.func)=='need'and
         ast.unparse(final.value.args[0])=="len(ids) == len(set(ids)) and (not require_all or set(ids) == {row['pid'] for row in rows}) and (query(sql) == rows)"and
         len(final.value.args)==2 and final.value.args[1].value=='all_required_backends_need_unique_positive_stable_kernel_attribution',
         'exact_pinned_host_final_positive_complete_stable_kernel_guard_required')
    # Keep the duplicate/unmapped prefix hard. The original final query is
    # executed exactly once, only after that prefix has actually passed.
    prefix=copy.deepcopy(final);prefix.value.args[0].values=prefix.value.args[0].values[:-1]
    replacement=ast.parse("""final_rows=query(sql)
need(valid_final_source_rows(final_rows),'final_kernel_query_must_be_actual_bounded_unique_source_rows')
if final_rows!=rows:raise KernelQueryChurn(rows,final_rows)
""").body
    fn.body[-2:-1]=[prefix,*replacement]
    values={**host_module.__dict__,'KernelQueryChurn':KernelQueryChurn,'valid_final_source_rows':valid_final_source_rows}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),str(Path(__file__).absolute()),'exec'),values)
    return values['kernel_backends']


def current_kernel(authority,*args,fence):
    need(len(args)==6 and args[2]==73004621 and args[5]is True,'classified_retry_only_for_complete_source_role_attribution')
    authority.kernel_attempts=[]
    for attempt in range(3):
        try:
            value=authority.kernel_function(*args)
            authority.kernel_attempts.append({'attempt':attempt+1,'validated':True,'fixedCode':None})
            return value
        except KernelQueryChurn as error:
            authority.kernel_attempts.append({'attempt':attempt+1,'validated':False,'fixedCode':str(error),
                'positiveCompleteAttributionProved':True,'initialRows':len(error.before),'finalRows':len(error.after),
                'initialRowsSha256':sha(encoded(error.before)),'finalRowsSha256':sha(encoded(error.after))})
            need(authority._snapshot()==fence==authority.expected,'source_actor_static_private_or_route_changed_during_classified_kernel_churn')
            if attempt==2:raise
            time.sleep(.025)
    raise RuntimeError('bounded_classified_kernel_observation_incomplete')


class Authority:
    def __init__(self,result_sha,input_sha,read_config=None):
        need(pin(result_sha)and pin(input_sha),'actual_ordinary_source_result_and_input_required')
        self.result_sha,self.input_sha=result_sha,input_sha;self.read_config=read_config;self.ready=False
        self.intake=module(INTAKE,INTAKE_SHA);self.runtime=module(RUNTIME,RUNTIME_SHA)
        self.owner=self.runtime.Owner(input_sha);self.read_parts=None;self.kernel_function=classified_kernel(self.owner.c.host_module)
    def _units(self):
        return sorted({SOURCE,FRESH,*self.owner.h.source.rpc.PROXY_UNITS,*[self.owner.h.proxy_unit(c)for c in self.runtime.CHAINS]})
    def _snapshot(self,initial=False):
        states=state_batch(self.units);properties_by_unit={unit:properties(unit)for unit in self.units}
        selected={unit:selected_properties(properties_by_unit[unit],self.property_keys[unit])for unit in self.units}
        for unit,row in states.items():
            equal_or_fail('same_positive_acknowledged_source_and_nine_route_epochs_required',
                {key:self.expected_states[unit][key]for key in('MainPID','InvocationID')},{key:row[key]for key in('MainPID','InvocationID')})
        if not initial:
            equal_or_fail('source_or_route_unit_state_changed',self.expected_states,states)
            equal_or_fail('source_or_route_unit_properties_changed',self.expected_properties,selected)
        process=process_frame(states,self.mounts);files=file_frame(self.paths)
        return {'states':states,'properties':selected,'process':process,'files':files,'activation':activation_frame(self.units+self.retired_units),'retired':retired_frame(self.retired_units),'bootId':Path('/proc/sys/kernel/random/boot_id').read_text().strip()}
    def preflight(self):
        need(not self.ready,'one_full_preflight_per_authority_instance_required')
        first=self.intake.observe_runtime(self.result_sha,self.input_sha);self.binding=first['binding'];owner=self.owner;op=owner.operation()
        need(self.binding['routingMode']=='paid'and self.binding['currentWriterQualified']is True,'this_authority_only_covers_actual_active_ordinary_paid_epoch')
        self.units=self._units();states=state_batch(self.units);self.expected_states=states
        self.retired_units=sorted(op['retirement']['units'])
        source=owner.journal('result.json')['source'];fresh=owner.h.source.actor(FRESH)
        self.actors={SOURCE:source,FRESH:fresh}
        for unit,actor in self.actors.items():need(states[unit]['MainPID']==str(actor['parent']['pid'])and states[unit]['InvocationID']==actor['unit']['InvocationID']and states[unit]['ControlGroup']==actor['unit']['ControlGroup'],'same_full_qualified_source_and_temporary_actors_required')
        for chain in self.runtime.CHAINS:
            actor=owner.journal(chain+'-started.json')['actor'];unit=owner.h.proxy_unit(chain)
            need(states[unit]['MainPID']==str(actor['pid'])and states[unit]['InvocationID']==actor['invocation']and states[unit]['ControlGroup']==actor['cgroup'],'same_four_ordinary_proxy_ACKs_required')
        for unit,value in owner.original['retainedRPC'].items():
            actor=value['packet']['actor'];need(states[unit]['MainPID']==str(actor['pid'])and states[unit]['InvocationID']==actor['invocation']and states[unit]['ControlGroup']==actor['cgroup'],'same_five_original_retained_proxy_actors_required')
        security=set(owner.leaf.UNIT_SECURITY_FIELDS);self.property_keys={unit:security|SERVICE_FIELDS|UNIT_FIELDS for unit in self.units}
        self.property_keys[SOURCE]|=set(owner.original['sourceRuntime'])
        service=properties(SOURCE)['Service'];self.mounts={}
        for key in ['BindPaths','BindReadOnlyPaths']:
            value=service[key];need(value['type']=='a(ssbt)'and len(value['data'])==3 and all(type(r)is list and len(r)==4 and type(r[0])is type(r[1])is str and type(r[2])is bool and type(r[3])is int for r in value['data']),'actual_three_RW_and_three_RO_mounts_required')
            self.mounts.update({row[1]:row[0]for row in value['data']})
        need(len(self.mounts)==6,'six_distinct_current_source_mounts_required')
        self.paths=set(self.mounts.values())
        for value in [owner.original['inputs'],owner.original['sourceDefinitions'],owner.original['sourcePrivateInputs'],owner.original['sourceBoot'],owner.original['retainedRPC'],op['originalFreeRoutes'],op['publicFiles'],op['retirement']]:self.paths|=paths_from(value)
        for unit,row in states.items():
            self.paths.add(row['FragmentPath']);self.paths.update(row['DropInPaths'].split())
            env=properties(unit)['Service']['EnvironmentFiles'];need(env['type']=='a(sb)'and type(env['data'])is list,'actual_typed_ordered_environment_files_required')
            for path,optional in env['data']:need(type(path)is str and type(optional)is bool,'literal_environment_files_required');self.paths.add(path)
        self.paths.update(arg.partition('=')[2]for arg in source['parent']['argv']if arg.startswith('--env-file='))
        for actor in self.actors.values():
            for process in actor['processes']:self.paths.add(process['executable'])
        self.paths.add(str(owner.h.r.BOOT));self.paths.add(str(self.runtime.INPUT));self.paths.add(str(owner.old.ns.SOURCE_DROP))
        self.paths.update({str(Path(__file__).absolute()),str(INTAKE),str(RUNTIME)})
        for name in['operation.json','result.json','retired.json','source-paid-start-intent.json',*[c+'-started.json'for c in self.runtime.CHAINS],*[c+'-start-intent.json'for c in self.runtime.CHAINS]]:self.paths.add(str(self.runtime.BASE/name))
        self.paths.discard('');self.expected=self._snapshot(True);self.expected_properties=self.expected['properties']
        self.registration=self.intake.registration(owner.h.source.query)
        final=self.intake.observe_runtime(self.result_sha,self.input_sha)
        preflight_bookends(self,first,final)
        if self.read_config is not None:self._read_current(self.read_config)
        self.ready=True
        return {'validated':True,'format':FORMAT+'-preflight','sourceBindingSha256':sha(encoded(self.binding)),
                'frameSha256':sha(encoded(self.expected)),'fullPreflightSourceProof':final,'sourceAuthorityPrepared':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
    def _native(self):
        owner=self.owner;native=owner.h.source.native();owner.h.r.recovery_floor(owner.original['native'],native)
        owner.h.r.epoch_heartbeat(native,owner.journal('source-paid-start-intent.json'))
        need(str(native['app']['is_ready'])=='1'and native['schemaOid']==self.binding['schemaOid']and native['tables']==self.binding['nativeTableIdentities']and native['cache']==self.binding['syncCacheIdentity']and native['app']['build_id']==self.binding['buildId'],
             'fresh_live_ready_native44_cache_and_heartbeat_required')
        return native
    def current(self,inverse=False):
        need(self.ready and inverse is False,'actual_complete_forward_sameactor_preflight_required')
        started=time.monotonic_ns();first=self._snapshot();equal_or_fail('sameactor_private_program_or_mount_drift',self.expected,first)
        owner=self.owner
        need(owner.h.source.inputs()==owner.original['inputs'],'all_original_source_code_private_files_builds_and_role_inputs_required')
        native=self._native()
        need(self.intake.registration(owner.h.source.query)==self.registration,'same_actual_registered_twelve_source_definitions_required')
        finance=financial_current(owner)
        kernels=current_kernel(self,owner.h.source.query,owner.h.observer,73004621,self.actors,{SOURCE:(970,964),FRESH:(970,964)},True,fence=first)
        need(kernels[SOURCE],'positive_complete_current_source_backend_attribution_required')
        native=self._native()
        need(owner.h.source.inputs()==owner.original['inputs'],'same_original_source_inputs_after_positive_kernel_required')
        equal_or_fail('positive_complete_source_kernel_and_sameactor_final_CAS_required',first,self._snapshot())
        stable={**self.binding,'format':FORMAT,'operatorSha256':sha(Path(__file__).read_bytes()),'ordinarySourceOperatorSha256':RUNTIME_SHA,
            'originalWholeValidatorPassed':False,'sourceActorQualified':True,'currentWriterQualified':True,'sourceKind':'ordinary-standalone',
            'sourceAuthorityFrameSha256':sha(encoded(first)),'sourceKernelActors':{SOURCE:self.actors[SOURCE]},'financialAuthorityQualified':False,
            'databaseWrites':0,'serviceActions':0,'providerCalls':0}
        self.last_observation={'native':native,'positiveKernelSessions':sum(map(len,kernels.values())),'kernelAttempts':copy.deepcopy(self.kernel_attempts),'financialCurrent':finance,'elapsedNanoseconds':time.monotonic_ns()-started}
        return stable
    def _read_current(self,config):
        need(type(config)is dict and set(config)=={'admissionSha256','readPlanSha256','readContextInputSha256'}and all(pin(v)for v in config.values()),'actual_V5_read_ref3_required')
        if self.read_parts is None:
            entry=module(READ,READ_SHA);ack=entry.acknowledgement(config['admissionSha256'])
            need(ack['planSha256']==config['readPlanSha256']and ack['contextInputSha256']==config['readContextInputSha256'],'same_actual_native143_and_V5_71_ack_required')
            namespace=entry.namespace();parts=namespace.admitted_components(config['admissionSha256'])
            host=parts['host'];creator=host.creator;i=creator.intake();factory=i.module(creator.FACTORY,creator.FACTORY_SHA)
            target=factory.namespace(i.protected(creator.TEMPLATE,creator.TEMPLATE_SHA),creator.TEMPLATE_SHA,Path(creator.__file__).absolute(),{'READ_SCHEMA':creator.READ_SCHEMA,'READ_IDENTITY':creator.READ_IDENTITY})
            self.read_target_sql=target.target_sql(creator.validate_plan(i.document(creator.PLAN,creator.PLAN_SHA)))
            saved=creator.document(creator.BASE/'created.json',ack['createdReceiptSha256'])
            self.read_target=read_data_identity(saved['target']);self.read_query=host.parts['readerHost'].query
            baseline=i.module(entry.BASELINE,entry.BASELINE_SHA)
            paths={str(folder/name)for folder in[namespace.BASE,entry.BASELINE_BASE]for name in['result.json','before.json','rehearsed.json','commit-intent.json','inverse-intent.json']}
            paths|={str(creator.BASE/name)for name in['created.json','before.json','rehearsed.json','commit-intent.json']}
            paths|={str(p)for p in[namespace.PLAN,entry.INPUT,baseline.INPUT,baseline.PLAN,creator.INPUT,creator.PLAN,READ,entry.CREATOR,entry.BASELINE]}
            self.read_record_paths=paths;self.read_records=file_frame(paths)
            self.read_parts=(config.copy(),namespace,parts)
        expected,namespace,parts=self.read_parts;need(config==expected,'one_read_admission_triple_per_authority_required')
        need(file_frame(self.read_record_paths)==self.read_records,'actual_immutable_read_journal_input_or_plan_changed')
        need(read_data_identity(self.read_query(self.read_target_sql))==self.read_target,'actual_created_V5_object_body_OID_columns_and_marker_changed')
        fn=namespace.validate_catalog_current
        current=types.FunctionType(fn.__code__,{**fn.__globals__,'admitted_components':lambda pin:parts},fn.__name__,fn.__defaults__)
        return current(config['admissionSha256'])
    def metadata_refresh(self,read_config=None):
        need(self.ready,'actual_full_preflight_before_live_metadata_refresh_required')
        config=read_config or self.read_config;first=self._read_current(config);source=self.current();after=self._read_current(config)
        need(first==after,'full_READ143_plus71_graph_or_all_columns_changed')
        return {'validated':True,'readAdmissionSha256':config['admissionSha256'],'readPlanSha256':config['readPlanSha256'],
                'readContextInputSha256':config['readContextInputSha256'],'catalogSha256':first['catalogSha256'],'sourceBinding':source,'inverseOnly':False,'currentReadCatalog':after,
                'originalWholeValidatorPassed':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
    def finish(self):
        need(self.ready,'actual_preflight_required_before_full_postflight');value=self.intake.observe_runtime(self.result_sha,self.input_sha)
        equal_or_fail('postflight_source_binding_changed',self.binding,value['binding'])
        equal_or_fail('postflight_source_frame_changed',self.expected,self._snapshot())
        return {'validated':True,'fullPostflightSourceProof':value,'sourceBindingSha256':sha(encoded(self.binding)),
                'databaseWrites':0,'serviceActions':0,'providerCalls':0}

def exclusive(path,value):
    raw=encoded(value);fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        with os.fdopen(fd,'wb',closefd=False)as out:out.write(raw);out.flush();os.fsync(fd)
    finally:os.close(fd)
    directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(directory)
    finally:os.close(directory)
    return sha(raw)


for _method in('__init__','preflight','current','metadata_refresh','finish'):
    setattr(Authority,_method,audited_failure(getattr(Authority,_method)))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--qualify',nargs=3,metavar=('NEW_CAPTURE_ID','ACTUAL_SOURCE_RESULT_SHA','ACTUAL_SOURCE_INPUT_SHA'))
    parser.add_argument('--read-ref',nargs=3,metavar=('ACTUAL_V5_READ_ACK','ACTUAL_V5_READ_PLAN','ACTUAL_V5_READ_INPUT'))
    args=parser.parse_args()
    if not args.qualify:
        need(args.read_ref is None,'read_ref_requires_an_explicit_readonly_qualification')
        print(json.dumps({'format':FORMAT,'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0,'productionTimingQualified':False}));return
    name,result,input_sha=args.qualify
    need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_root_actual_readonly_source_qualification_required')
    need(re.fullmatch('[a-z][a-z0-9-]{0,47}',name)and pin(result)and pin(input_sha),'bounded_new_capture_name_and_actual_source_refs_required')
    config=None if args.read_ref is None else dict(zip(['admissionSha256','readPlanSha256','readContextInputSha256'],args.read_ref))
    need(config is None or all(pin(v)for v in config.values()),'actual_V5_read_ref3_required')
    signal.signal(signal.SIGALRM,lambda *_:need(False,'bounded_readonly_source_qualification_expired'));signal.alarm(240);os.umask(0o077)
    # These are audit records only. This program cannot dispatch manager/SQL
    # effects. Each failed capture remains separate and is never resumed.
    CAPTURE_BASE.mkdir(mode=0o700,parents=True,exist_ok=True)
    for folder in[CAPTURE_BASE.parent,CAPTURE_BASE]:
        row=folder.lstat();need(stat.S_ISDIR(row.st_mode)and row.st_uid==row.st_gid==0 and stat.S_IMODE(row.st_mode)==0o700,'root_private_source_qualification_parent_required')
    folder=CAPTURE_BASE/name;folder.mkdir(mode=0o700)
    exclusive(folder/'intent.json',{'format':FORMAT+'-qualification-intent','operatorSha256':sha(Path(__file__).read_bytes()),
        'sourceResultSha256':result,'sourceInputSha256':input_sha,'readConfig':config,'databaseWrites':0,'serviceActions':0,'providerCalls':0})
    authority=None
    try:
        authority=Authority(result,input_sha,config);preflight=authority.preflight();started=time.monotonic_ns()
        current=authority.current()if config is None else authority.metadata_refresh()
        elapsed=time.monotonic_ns()-started;observation=authority.last_observation;postflight=authority.finish()
        value={'format':FORMAT+'-qualification','validated':True,'operatorSha256':sha(Path(__file__).read_bytes()),
            'preflight':preflight,'current':current,'observation':observation,'postflight':postflight,'frame':authority.expected,
            'callbackElapsedNanoseconds':elapsed,'productionCallbackDeadlineQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
        digest=exclusive(folder/'result.json',value)
        print(json.dumps({'format':FORMAT,'validated':True,'resultSha256':digest,'callbackElapsedNanoseconds':elapsed,
            'nativeRelations':len(authority.binding['nativeTableIdentities']),'activeUnits':len(authority.units),'retiredUnits':len(authority.retired_units),
            'positiveKernelSessions':observation['positiveKernelSessions'],'productionCallbackDeadlineQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0},sort_keys=True))
    except Exception as error:
        code=str(error)if isinstance(error,RuntimeError)and re.fullmatch('[a-zA-Z0-9_]+',str(error))else type(error).__name__
        reference=getattr(error,'_ordinary_source_failure_audit',None)
        digest=exclusive(folder/'failure.json',{'format':FORMAT+'-qualification-failure','fixedCode':code,'privateFailureAudit':reference,'kernelAttempts':getattr(authority,'kernel_attempts',[]),'databaseWrites':0,'serviceActions':0,'providerCalls':0})
        print(json.dumps({'format':FORMAT,'validated':False,'fixedCode':code,'privateFailureSha256':digest,'privateFailureAudit':reference,'automaticRetryAllowed':False}));raise SystemExit(1)


if __name__=='__main__':main()
