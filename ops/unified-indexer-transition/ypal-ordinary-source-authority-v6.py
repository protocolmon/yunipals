#!/usr/bin/env python3
"""Exact standalone source authority with narrowly proved backend disappearance."""
import ast
import copy
import hashlib
import json
from pathlib import Path
import stat
import time
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-source-authority-v6.py'
FORMAT='yunipals-ypal-ordinary-source-authority-v6'
CAPTURE_BASE=Path('/var/backups/yunipals-ypal-ordinary-source-authority-v6-20261025/captures')
FAILURE_BASE=CAPTURE_BASE.parent/'failures'
FROZEN=OPS/'ypal-ordinary-source-authority-v5.py'
FROZEN_SHA='052f363ca94a74aed1b278079c3e70661c8068328342bba559eecfe3c1939ac0'
OBSERVER=OPS/'ypal-old-runtime-inventory-v1.py'
OBSERVER_SHA='7034021dd679f1f6739e2a3591da9b9507e555382f86cbfc3de22f52829d4c3b'
SESSION_SQL="SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backendStart',backend_start::text,'clientAddress',host(client_addr),'clientPort',client_port)ORDER BY pid),'[]'::jsonb) FROM pg_stat_activity WHERE usesysid=73004621 AND datid=17584"
SOURCE_PINS={'ypal-ordinary-source-authority-v5.py':'052f363ca94a74aed1b278079c3e70661c8068328342bba559eecfe3c1939ac0',
    'ypal-old-runtime-inventory-v1.py':'7034021dd679f1f6739e2a3591da9b9507e555382f86cbfc3de22f52829d4c3b',
    'ypal-alchemy-source-switch-v1.host.py':'3b73d2f804c2c64f212c6b11eb3f108087a54af580baecb35ddffa2033dd4e02',
    'ypal-alchemy-ordinary-consumer-context-v1.py':'5a1f4629899bed7ad498c84f016afa75cacbaf67663974d94c65453a84787986',
    'ypal-alchemy-ordinary-runtime-v1.py':'3bf5811a6bc6163ede96e18ce57e9b0b45583889c15a639b79291d8c3be31be5'}


def need(value,code):
    if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()


def public(path,digest):
    for item in[*path.parents,path]:
        row=item.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,
            'protected_source_authority_successor_source_required')
    before=path.lstat();raw=path.read_bytes();after=path.lstat()
    need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and 0<len(raw)==before.st_size<200000 and sha(raw)==digest and
         all(getattr(before,key)==getattr(after,key)for key in['st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns']),
         'exact_source_authority_successor_source_required')
    return raw


class BackendDisappeared(RuntimeError):
    def __init__(self,before,after,gone):
        super().__init__('proved_initial_backend_process_and_database_epoch_disappeared')
        self.before,self.after,self.gone=before,after,gone


def backend_probe_program(raw):
    """Retain the exact7034 FD body; classify only its actual /proc/PID/stat ENOENT."""
    need(sha(raw)==OBSERVER_SHA,'exact_original_backend_inventory_program_required')
    tree=ast.parse(raw)
    assignments=[node for node in tree.body if isinstance(node,ast.Assign)and len(node.targets)==1 and
                 isinstance(node.targets[0],ast.Name)and node.targets[0].id=='PEER_FDS']
    need(len(assignments)==1,'one_frozen_backend_FD_program_required')
    program=ast.parse(ast.literal_eval(assignments[0].value));loops=[node for node in program.body if isinstance(node,ast.For)]
    need(len(loops)==1 and ast.unparse(loops[0].target)=='pid'and ast.unparse(loops[0].iter)=='pids',
         'one_actual_backend_PID_inventory_loop_required')
    loop=loops[0]
    need(len(loop.body)==11 and ast.unparse(loop.body[0])=="p = pathlib.Path('/proc') / str(pid)"and
         isinstance(loop.body[1],ast.FunctionDef)and loop.body[1].name=='identity'and
         ast.unparse(loop.body[2])=='before = identity()'and ast.unparse(program.body[-1])=='print(json.dumps(result, sort_keys=True))',
         'exact_reviewed_original_backend_stat_FD_and_output_cuts_required')
    original=copy.deepcopy(loop.body[2:]);original.insert(1,ast.parse('observed_ticks=before').body[0])
    handler=ast.parse("""try:
 pass
except FileNotFoundError as error:
 if error.filename!=str(p/'stat'):raise
 print(json.dumps({'format':PROBE_FORMAT,'complete':False,'gone':{'pid':pid,'startTicks':observed_ticks,'file':'stat'},'fds':{}},sort_keys=True))
 raise SystemExit(0)
""").body[0]
    handler.body=original
    loop.body=loop.body[:2]+[ast.parse('observed_ticks=None').body[0],handler]
    program.body.insert(0,ast.parse('PROBE_FORMAT='+repr(FORMAT+'-backend-fds')).body[0])
    program.body[-1]=ast.parse("print(json.dumps({'format':PROBE_FORMAT,'complete':True,'gone':None,'fds':result},sort_keys=True))").body[0]
    return ast.unparse(ast.fix_missing_locations(program))


def backend_probe(observer,pids):
    raw=public(OBSERVER,OBSERVER_SHA);program=backend_probe_program(raw)
    # The original runner remains strict for every nonzero exit, stderr,
    # timeout, assertion, permission problem and unrelated missing file.
    value=json.loads(observer.run(['/usr/bin/setpriv','--reuid=111','--regid=113','--clear-groups','--no-new-privs',
        '--inh-caps=-all','--ambient-caps=-all','/usr/bin/python3','-I','-B','-c',program,json.dumps(pids),'111']))
    need(type(value)is dict and set(value)=={'format','complete','gone','fds'}and
         value['format']==FORMAT+'-backend-fds'and type(value['complete'])is bool and type(value['fds'])is dict,
         'exact_typed_new_backend_inventory_reply_required')
    if value['complete']:
        need(value['gone']is None and set(value['fds'])=={str(pid)for pid in pids}and all(
            type(row)is dict and set(row)=={'startTicks','socketInodes'}and type(row['startTicks'])is int and row['startTicks']>0 and
            type(row['socketInodes'])is list and len(row['socketInodes'])<=512 and
            all(type(inode)is int and inode>0 for inode in row['socketInodes'])and row['socketInodes']==sorted(set(row['socketInodes']))
            for row in value['fds'].values()),'complete_actual_original_backend_epoch_and_FD_reply_required')
    else:
        gone=value['gone']
        need(value['fds']=={}and type(gone)is dict and set(gone)=={'pid','startTicks','file'}and
             type(gone['pid'])is int and gone['pid']in pids and gone['file']=='stat'and
             (gone['startTicks']is None or type(gone['startTicks'])is int and gone['startTicks']>0),
             'only_typed_missing_initial_backend_stat_can_be_classified')
    need(public(OBSERVER,OBSERVER_SHA)==raw,'backend_inventory_source_changed_during_probe')
    return value


def proc_epoch(pid):
    try:raw=(Path('/proc')/str(pid)/'stat').read_text()
    except (FileNotFoundError,ProcessLookupError):return None
    value=int(raw[raw.rfind(')')+2:].split()[19]);need(value>0,'positive_backend_process_epoch_required');return value


class Observer:
    def __init__(self,original,query,seen,valid):self.original,self.query,self.seen,self.valid=original,query,seen,valid;self.calls=0
    def __getattr__(self,name):return getattr(self.original,name)
    def peer_fds(self,pids,uid,gid):
        self.calls+=1
        if self.calls!=1:return self.original.peer_fds(pids,uid,gid)
        need(uid==111 and gid==113 and len(self.seen)==1 and pids==[row['pid']for row in self.seen[0]],
             'only_exact_first_source_role_backend_probe_may_classify_disappearance')
        value=backend_probe(self.original,pids)
        if value['complete']:return value['fds']
        before=self.seen[0];gone=value['gone'];old=next(row for row in before if row['pid']==gone['pid'])
        after=self.query(SESSION_SQL)
        need(self.valid(after)and (old['pid'],old['backendStart'])not in{(row['pid'],row['backendStart'])for row in after},
             'exact_failed_initial_backend_database_epoch_must_be_gone_from_fresh_bounded_role_query')
        current=proc_epoch(gone['pid'])
        need(current is None or gone['startTicks']is not None and current!=gone['startTicks'],
             'failed_backend_process_must_be_absent_or_its_observed_epoch_proved_gone')
        raise BackendDisappeared(copy.deepcopy(before),copy.deepcopy(after),{**gone,'postProcessStartTicks':current,
            'backendStart':old['backendStart'],'processEpochGone':True,'databaseEpochGone':True})


def current_kernel(authority,*args,fence):
    need(len(args)==6 and args[2]==73004621 and args[5]is True,
         'backend_disappearance_route_requires_complete_fixed_source_role_attribution')
    query,observer,role,actors,uid_gid,require_all=args
    authority.kernel_attempts=[];deadline=time.monotonic()+90
    for attempt in range(3):
        need(time.monotonic()<deadline,'bounded_complete_source_kernel_capture_expired');seen=[]
        def checked(sql):
            need(sql==SESSION_SQL and len(seen)<2,'only_actual_fixed_bounded_source_kernel_queries_required')
            rows=query(sql);need(authority.kernel_rows_valid(rows),'actual_bounded_unique_initial_and_final_source_rows_required')
            seen.append(copy.deepcopy(rows));return rows
        proxy=Observer(observer,query,seen,authority.kernel_rows_valid)
        try:
            value=authority.kernel_function(checked,proxy,role,actors,uid_gid,require_all)
        except BackendDisappeared as error:
            authority.kernel_attempts.append({'attempt':attempt+1,'validated':False,'fixedCode':str(error),
                'initialRows':len(error.before),'finalRows':len(error.after),'initialRowsSha256':sha(encoded(error.before)),
                'finalRowsSha256':sha(encoded(error.after)),'gone':copy.deepcopy(error.gone),
                'positiveCompleteAttributionProved':False,'nextWholeCaptureRequired':True,'effectsRetried':False})
            need(authority._snapshot()==fence==authority.expected,
                 'source_actor_static_private_or_route_changed_during_proved_backend_disappearance')
            if attempt==2:raise
        except authority.kernel_churn_type as error:
            authority.kernel_attempts.append({'attempt':attempt+1,'validated':False,'fixedCode':str(error),
                'positiveCompleteAttributionProved':True,'initialRows':len(error.before),'finalRows':len(error.after),
                'initialRowsSha256':sha(encoded(error.before)),'finalRowsSha256':sha(encoded(error.after)),'effectsRetried':False})
            need(authority._snapshot()==fence==authority.expected,
                 'source_actor_static_private_or_route_changed_during_classified_kernel_churn')
            if attempt==2:raise
        else:
            need(len(seen)==2 and time.monotonic()<deadline,'complete_stable_bounded_source_kernel_capture_required')
            authority.kernel_attempts.append({'attempt':attempt+1,'validated':True,'fixedCode':None,
                'positiveCompleteAttributionProved':True,'effectsRetried':False})
            return value
        need(time.monotonic()<deadline,'bounded_complete_source_kernel_capture_expired');time.sleep(.025)
    raise RuntimeError('bounded_proved_source_kernel_observation_incomplete')


def composition():
    raw=public(FROZEN,FROZEN_SHA);tree=ast.parse(raw);changed=set()
    for node in tree.body:
        if isinstance(node,ast.Assign)and len(node.targets)==1 and isinstance(node.targets[0],ast.Name):
            key=node.targets[0].id
            if key=='FORMAT':node.value=ast.Constant(FORMAT);changed.add(key)
            elif key=='CAPTURE_BASE':node.value=ast.parse('Path('+repr(str(CAPTURE_BASE))+')',mode='eval').body;changed.add(key)
    need(changed=={'FORMAT','CAPTURE_BASE'},'exact_new_source_authority_domain_and_audit_root_required')
    value=types.ModuleType('genuine_source_authority_successor');value.__file__=str(FILE)
    exec(compile(ast.fix_missing_locations(tree),str(FILE),'exec'),value.__dict__)
    value.current_kernel=current_kernel
    value.Authority.kernel_rows_valid=staticmethod(value.valid_final_source_rows)
    value.Authority.kernel_churn_type=value.KernelQueryChurn
    return value


def __getattr__(name):return getattr(composition(),name)
def main():
    import sys
    if len(sys.argv)==1:
        print(json.dumps({'format':FORMAT,'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0,
                          'productionTimingQualified':False}));return
    composition().main()
if __name__=='__main__':main()
