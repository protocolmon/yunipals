#!/usr/bin/env python3
"""Fixed invocation, existing scalar journal/metrics/CPU counters only; no RPC/SQL."""
from collections import Counter
from datetime import datetime,timedelta,timezone
import json,math,os,re,signal,stat,subprocess,urllib.request
from pathlib import Path
UNIT='yunipals-unified-source6-free-v2.service'
INV='dab6fcd2704c461a9af2123168aec8f0'
PROXY_UNIT='yunipals-market-production-rpc@bnb.service'
PROXY_INV='fc23f00ee3884897b317c381a4ac6fd2'
RUNTIME_RECEIPT_SHA='60ebedb5c1361218315bfb14e9eb6d611fa0c342e56aa49a6ec4bf7658708414'
POOL_SHA='d75dc97a6bf4ffe29c3ba7242a173565e50afd27fb758e7c4e8781b6baae599b'
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','TZ':'UTC'}
FORMAT='yunipals-source6-selective-phase-observer-v2'
CHAINS={'bnb','base','mainnet','polygon'}
METHODS={'eth_getLogs','eth_getBlockByNumber','eth_chainId','eth_blockNumber','eth_getTransactionReceipt','eth_getCode','eth_getTransactionByHash','eth_getTransactionByBlockNumberAndIndex'}
TITLES={'Fetched block range data':'fetch_logs','Fetched block data':'fetch_blocks','Updated block range estimate for fetching backfill JSON-RPC data':'outer_range_estimate','Updated eth_getLogs range':'inner_log_range','Indexed block range':'index','Queried backfill JSON-RPC data from database':'cache_extract','Completed database query':'database_query','Sent JSON-RPC request':'rpc_bucket_wait','Received JSON-RPC response':'rpc_response','Fetching backfill JSON-RPC data is taking longer than expected':'slow_interval'}
DB={'insert_intervals','select_intervals','insert_blocks','insert_transactions','insert_transaction_receipts','insert_logs','insert_traces','select_blocks','select_transactions','select_transaction_receipts','select_logs','select_traces','update_checkpoints','insert_rpc_requests','select_rpc_requests'}
STEPS={'format','decode','build','prefetch','begin','index','load','finalize','commit'}
POOLS={'admin','sync','user','readonly','migrate'}
ANSI=re.compile(r'\x1b\[[0-9;]*m')
def fail(code):raise RuntimeError(code)
def scalar(v):return v if type(v)in {int,float}and math.isfinite(v)and 0<=v<=10**18 else None

def command(argv,cap):
    with subprocess.Popen(argv,env=ENV,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)as p:
        raw=p.stdout.read(cap+1)
        if len(raw)>cap:p.kill();p.communicate();fail('fixed_command_output_bound_exceeded')
        try:_,err=p.communicate(timeout=12)
        except subprocess.TimeoutExpired:p.kill();p.communicate();fail('fixed_command_timeout')
        if p.returncode or err:fail('fixed_readonly_command_failed')
        return raw

def state(unit,inv):
    if unit not in {UNIT,PROXY_UNIT}or not isinstance(inv,str)or not re.fullmatch('[a-f0-9]{32}',inv):fail('actual_runtime_invocations_required')
    group='/system.slice/'+unit if unit==UNIT else '/system.slice/system-yunipals\\x2dmarket\\x2dproduction\\x2drpc.slice/'+unit
    keys=['Id','LoadState','ActiveState','SubState','InvocationID','MainPID','ControlGroup','CPUUsageNSec','CPUQuotaPerSecUSec','MemoryCurrent']
    raw=command(['/usr/bin/systemctl','show','--all',unit,*['--property='+k for k in keys]],16000)
    value=dict(line.split('=',1)for line in raw.decode().splitlines())
    if(set(value)!=set(keys)or value['Id']!=unit or value['LoadState']!='loaded'or value['InvocationID']!=inv or value['ActiveState']!='active'or value['SubState']!='running'or not value['MainPID'].isdigit()or int(value['MainPID'])<=1 or value['ControlGroup']!=group):fail('exact_running_source_required')
    return value

def cpu():
    path=Path('/sys/fs/cgroup/system.slice')/UNIT/'cpu.stat'
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        s=os.fstat(fd)
        if not stat.S_ISREG(s.st_mode):fail('fixed_cgroup_cpu_stat_required')
        raw=os.read(fd,4097)
        if len(raw)>4096:fail('bounded_cgroup_cpu_stat_required')
    finally:os.close(fd)
    allowed={'usage_usec','user_usec','system_usec','nr_periods','nr_throttled','throttled_usec','nr_bursts','burst_usec'}
    result={}
    for line in raw.decode().splitlines():
        key,value=line.split()
        if key in allowed and value.isdigit():result[key]=int(value)
    return result

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*_):return None

def metrics():
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    with opener.open('http://127.0.0.1:9024/metrics',timeout=3)as r:
        raw=r.read(2000001)
        if r.status!=200 or len(raw)>2000000:fail('bounded_fixed_loopback_metrics_required')
    result=[]
    for line in raw.decode().splitlines():
        if not line or line.startswith('#'):continue
        match=re.fullmatch(r'([A-Za-z_:][A-Za-z0-9_:]*)(?:\{(.*)\})?\s+([^ ]+)(?:\s+[0-9]+)?',line)
        if not match:continue
        name,text,v=match.groups()
        try:v=scalar(float(v))
        except ValueError:continue
        if v is None:continue
        labels={k:x for k,x in re.findall(r'([A-Za-z_][A-Za-z0-9_]*)="([^"\\]*)"',text or'')};out=None
        if name in {'ponder_historical_extract_duration','ponder_historical_transform_duration'}and labels.get('step')in STEPS:out={'step':labels['step']}
        elif name=='ponder_historical_concurrency_group_duration'and labels.get('group')in {'extract','transform'}:out={'group':labels['group']}
        elif name in {'ponder_database_method_duration_sum','ponder_database_method_duration_count','ponder_database_method_error_total'}and labels.get('method')in DB:out={'method':labels['method']}
        elif name in {'ponder_postgres_query_total','ponder_postgres_query_queue_size','ponder_postgres_pool_connections'}and labels.get('pool')in POOLS:
            out={'pool':labels['pool']}
            if name.endswith('connections'):
                if labels.get('kind')not in {'idle','total'}:continue
                out['kind']=labels['kind']
        elif name in {'ponder_rpc_request_duration_sum','ponder_rpc_request_duration_count','ponder_rpc_request_error_total'}and labels.get('chain')in CHAINS and labels.get('method')in METHODS:out={'chain':labels['chain'],'method':labels['method']}
        if out is not None:result.append({'name':name,'labels':out,'value':v})
    if len(result)>300:fail('bounded_scalar_metric_rows_required')
    return result

def number_field(value,text,key):
    n=value.get(key)if value else None
    if n is None:
        found=re.search(r'(?:^|\s)'+re.escape(key)+r'=([0-9]+(?:\.[0-9]+)?)(?=\s|$)',text)
        if found:n=float(found[1])
    return scalar(n)

def journal():
    since=(datetime.now(timezone.utc)-timedelta(minutes=8)).strftime('%Y-%m-%d %H:%M:%S UTC')
    raw=command(['/usr/bin/journalctl','_SYSTEMD_UNIT='+UNIT,'_SYSTEMD_INVOCATION_ID='+INV,'--since',since,'-n','1200','--no-pager','--output=json','--output-fields=MESSAGE,_SYSTEMD_UNIT,_SYSTEMD_INVOCATION_ID,__REALTIME_TIMESTAMP'],4000000)
    counts=Counter();out={chain:[]for chain in CHAINS};lines=raw.splitlines()
    for line in lines:
        row=json.loads(line)
        if row.get('_SYSTEMD_UNIT')!=UNIT or row.get('_SYSTEMD_INVOCATION_ID')!=INV or not isinstance(row.get('MESSAGE'),str):fail('exact_owned_journal_required')
        text=ANSI.sub('',row['MESSAGE']);value=None
        try:
            decoded=json.loads(text)
            if isinstance(decoded,dict)and isinstance(decoded.get('msg'),str):value=decoded
        except ValueError:pass
        if value:message=value['msg'];chain=value.get('chain')
        else:
            if re.match(r'^\d{2}:\d{2}:\d{2}\.\d{3}\s+(?:TRACE|DEBUG|INFO|WARN|ERROR)\s+',text)is None:continue
            message=text
            found=re.search(r'(?:^|\s)chain=(bnb|base|mainnet|polygon)(?=\s|$)',text);chain=found[1]if found else None
        if chain not in CHAINS:continue
        title=next((tag for phrase,tag in TITLES.items()if phrase in message),None)
        if title is None:continue
        counts[chain+':'+title]+=1;item={'phase':title}
        stamp=row.get('__REALTIME_TIMESTAMP')
        if isinstance(stamp,str)and stamp.isdigit():item['journalAtMicroseconds']=int(stamp)
        for key in ['duration','range','block_count','log_count','transaction_count','receipt_count','trace_count','event_count']:
            v=number_field(value,text,key)
            if v is not None:item[key]=v
        block_range=value.get('block_range')if value else None
        if block_range is None:
            found=re.search(r'(?:^|\s)block_range=(\[[0-9]+,\s*[0-9]+\])',text)
            if found:block_range=found[1]
        if isinstance(block_range,str):
            try:block_range=json.loads(block_range)
            except ValueError:block_range=None
        if isinstance(block_range,list)and len(block_range)==2 and all(type(x)is int and 0<=x<=10**12 for x in block_range)and block_range[1]>=block_range[0]:item['interval']={'from':block_range[0],'through':block_range[1],'span':block_range[1]-block_range[0]+1}
        for key,allowed in [('method',METHODS),('query',DB)]:
            v=value.get(key)if value else None
            if v is None:
                found=re.search(r'(?:^|\s)'+key+r'=([A-Za-z_]+)(?=\s|$)',text);v=found[1]if found else None
            if v in allowed:item[key]=v
        out[chain].append(item);out[chain]=out[chain][-24:]
    return {'windowMinutes':8,'inputRows':len(lines),'inputBytes':len(raw),'phaseCounts':dict(counts),'latest':out,'debugTraceRowsMayNotHaveBeenRetained':True,'transactionCountsAreMatchedRetainedNotFullPayloadCounts':True}

def proxy_scalars(value):
    unified=value.get('unified',{});route=unified.get('selective',{})
    if(value.get('freeRouting')is not True or value.get('paidFallbackOnFreeFailure')is not False or
       value.get('sourcePaidFallbackOnFreeFailure')is not False or unified.get('chainId')!=56 or
       unified.get('sourceRouting')!='free_first' or route.get('primaryIndices')!=[0]or route.get('poolSha256')!=POOL_SHA or
       route.get('preferred')!=0 or not isinstance(route.get('endpoints'),list)or len(route['endpoints'])!=1):fail('exact_free_qualified_route_required')
    endpoint=route['endpoints'][0]
    if(endpoint.get('primaryIndex')!=0 or type(endpoint.get('coolingDown'))is not bool):fail('qualified_endpoint_shape_required')
    def counters(row,keys):
        out={}
        for key in keys:
            value=row.get(key)
            if type(value)is not int or scalar(value)is None:fail('bounded_proxy_counter_required')
            out[key]=value
        return out
    traffic=value.get('traffic',{});method_rows={}
    for mode in ['free','paid']:
        row=traffic.get('methods',{}).get(mode,{})
        if not isinstance(row,dict):fail('proxy_method_counters_required')
        method_rows[mode]=counters({key:row.get(key,0)for key in METHODS},METHODS)
    result={'chainId':56,'freeRouting':True,'paidFallbackOnFreeFailure':False,'sourcePaidFallbackOnFreeFailure':False,
      'sourceRouting':'free_first','primaryIndices':[0],'poolSha256':POOL_SHA,
      'qualifiedEndpoint':{'primaryIndex':0,'coolingDown':endpoint['coolingDown'],**counters(endpoint,['successes','failures'])},
      'unifiedSource':counters(unified.get('traffic',{}).get('unified_source',{}),['freeCalls','paidCalls','refused']),
      'methodCounters':method_rows,'methodCounterScope':'all_proxy_workloads_not_only_selective',
      'qualifiedEndpointCounterUnit':'HTTP_dispatches_not_logical_RPC_calls',
      'load':counters(value,['activeUpstreamRequests','queuedSourceRequests','queuedSourceBytes','freeSourceMinimumIntervalMs','freeMinimumIntervalMs']),
      'traffic':counters(traffic,['freeFailures','freeOnlyFailures','freeRateLimitRetries','freeRateLimitWaitMs','freePacingWaitMs','sourcePacingTimeouts','sourceQueueTimeouts','overloadedBatches'])}
    transactions=unified.get('selectiveTransactions')
    if(not isinstance(transactions,dict)or transactions.get('primaryIndices')!=[1,2,3]or
       transactions.get('poolSha256')!=POOL_SHA or type(transactions.get('preferred'))is not int or
       not 0<=transactions['preferred']<3 or not isinstance(transactions.get('endpoints'),list)or
       len(transactions['endpoints'])!=3):fail('exact_transaction_route_required')
    endpoints=[]
    for row,index in zip(transactions['endpoints'],[1,2,3]):
        if(not isinstance(row,dict)or row.get('primaryIndex')!=index or type(row.get('coolingDown'))is not bool):
            fail('exact_transaction_endpoint_required')
        endpoints.append({'primaryIndex':index,'coolingDown':row['coolingDown'],**counters(row,['successes','failures'])})
    if result['unifiedSource']['paidCalls']!=0:fail('free_only_source_required')
    result['transactionRoute']={'primaryIndices':[1,2,3],'poolSha256':POOL_SHA,'preferred':transactions['preferred'],'endpoints':endpoints}
    result['transactionEndpointCounterScope']='shared_with_other_unified_source_reads_to_same_endpoint'
    return result

def proxy_metrics():
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    with opener.open('http://127.0.0.1:19204/metrics',timeout=3)as r:
        raw=r.read(2000001)
        if r.status!=200 or len(raw)>2000000:fail('bounded_fixed_proxy_metrics_required')
    return proxy_scalars(json.loads(raw))

def main():
    if os.geteuid()!=0 or os.uname().nodename!='yunipals-main':fail('fixed_root_host_required')
    before=state(UNIT,INV);proxy_before=state(PROXY_UNIT,PROXY_INV);firstcpu=cpu();j=journal();m=metrics();proxy=proxy_metrics();lastcpu=cpu();proxy_after=state(PROXY_UNIT,PROXY_INV);after=state(UNIT,INV)
    if any(before[k]!=after[k]for k in ['Id','LoadState','ActiveState','SubState','InvocationID','MainPID','ControlGroup']):fail('source_identity_changed')
    if any(proxy_before[k]!=proxy_after[k]for k in ['Id','LoadState','ActiveState','SubState','InvocationID','MainPID','ControlGroup']):fail('proxy_identity_changed')
    print(json.dumps({'format':FORMAT,'observedAt':datetime.now(timezone.utc).isoformat(),'unit':after,'runtimeReceiptSha256':RUNTIME_RECEIPT_SHA,'cpuBefore':firstcpu,'cpuAfter':lastcpu,'journal':j,'metricScalars':m,'bnbProxyUnit':proxy_after,'bnbProxyScalars':proxy,'providerCalls':0,'databaseQueries':0,'serviceJobs':0,'rawLogsOrMetricsExported':False,'upstreamPayloadBytesAvailable':False},sort_keys=True))
if __name__=='__main__':
    signal.signal(signal.SIGALRM,lambda *_:(_ for _ in ()).throw(TimeoutError('bounded_phase_observer_expired')));signal.alarm(45)
    try:main()
    except Exception as e:
        code=e.args[0]if type(e)is RuntimeError and e.args and re.fullmatch('[a-z_]+',str(e.args[0]))else'fixed_scalar_phase_observation_failed'
        print(json.dumps({'format':FORMAT,'completed':False,'errorClass':type(e).__name__,'fixedCode':code,'rawLogsOrMetricsExported':False}));raise SystemExit(1)
