from pathlib import Path
import hashlib,json,os,resource,signal,socket,subprocess,time
R=Path('/tmp/yunipals-arena-live-compat-20261022'); O=R/'ops/arena-current-genuine-rpc'
W=Path('/tmp/yunipals-arena-current-genuine-rpc-20261022-a'); W.mkdir(mode=0o700)
(W/'tmp').mkdir(mode=0o700)
N='/root/.nvm/versions/node/v24.18.1/bin/node'; AN='/tmp/yunipals-foundry/node_modules/@foundry-rs/anvil-linux-amd64/bin/anvil'
source='postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/yunipals_ponder_dependency_test'
operational='postgres://postgres:arena-local-test@127.0.0.1:55441/arena'
env={'PATH':str(Path(N).parent)+':/usr/local/bin:/usr/bin:/bin','LANG':'C.UTF-8','LC_ALL':'C.UTF-8','TZ':'UTC','TMPDIR':str(W/'tmp'),'PONDER_TELEMETRY_DISABLED':'1'}
# Exact local destinations only, including propagated Ponder subprocesses.
guard=W/'network-guard.mjs'
guard.write_text('''import net from "node:net";
const original=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){let value=args[0];if(Array.isArray(value))value=value[0];
if(typeof value==='object'&&typeof value.path==='string'&&/^\\/tmp\\/tsx-[0-9]+\\/[0-9]+\\.pipe$/.test(value.path))return original.apply(this,args);
const host=typeof value==='object'?(value.host??'localhost'):args[1],port=Number(typeof value==='object'?value.port:value);
if(!['127.0.0.1','localhost','::1'].includes(host)||![55441,56967,55446,55447].includes(port))throw Error('fixture_external_network_forbidden');return original.apply(this,args);};
''')
env['NODE_OPTIONS']='--max-old-space-size=2048 --import='+str(guard)
# The four retained artifacts authenticate every Solidity metadata source.
for art in (R/'contracts/arena/out').glob('*/*.json'):
 for name in json.loads(art.read_text())['metadata']['sources']:
  target=R/'contracts/arena'/name
  if not target.exists():
   actual=Path('/tmp/yunipals-arena-public-fixtures-20261021/contracts/arena')/name
   assert actual.is_file();target.parent.mkdir(parents=True,exist_ok=True);target.symlink_to(actual)
for port in [55446,55447]:
 with socket.socket() as s:assert s.connect_ex(('127.0.0.1',port))!=0,'Local fixture port already in use'
assert os.statvfs(W).f_bavail*os.statvfs(W).f_frsize>4*1024**3
# Confirm exact private fixture DB ownership boundary before any schema writes.
pre="""import pg from 'pg';const p=new pg.Pool({connectionString:process.env.ARENA_TEST_DATABASE_URL});const s=new pg.Pool({connectionString:process.env.PONDER_UNIFIED_TEST_DATABASE_URL});try{const r=await p.query(\"SELECT to_regnamespace('yunipals_arena') IS NULL AS absent,current_database() AS db\");if(!r.rows[0].absent||r.rows[0].db!=='arena')throw Error('Fresh owned operational schema required');if((await s.query('SELECT current_database() AS db')).rows[0].db!=='yunipals_ponder_dependency_test')throw Error('Source fixture DB differs');console.log(JSON.stringify({operationalInitiallyAbsent:true,sourceDatabaseVerified:true}));}finally{await p.end();await s.end();}"""
env.update({'ARENA_TEST_DATABASE_URL':operational,'PONDER_UNIFIED_TEST_DATABASE_URL':source})
check=subprocess.run([N,'--input-type=module','-e',pre],cwd=R/'apps/yunipals-market-api',env=env,capture_output=True,check=True,timeout=15)
(W/'preflight.json').write_bytes(check.stdout)
# Phrase belongs only to this new synthetic Anvil, never a live wallet.
mn=subprocess.run([N,'--input-type=module','-e',"import{generateMnemonic,english}from'viem/accounts';process.stdout.write(generateMnemonic(english));"],cwd=R/'apps/yunipals-market-api',env=env,capture_output=True,check=True,timeout=15).stdout.decode()
assert len(mn.split())==12
env['ARENA_FIXTURE_MNEMONIC']=mn
children=[];started=time.monotonic();result={'format':'arena-current-genuine-rpc-local-v1','passed':False,'providerCalls':0,'productionCalls':0,'mainnetTransactions':0};error=None
try:
 f=(W/'anvil.private.log').open('xb');a=subprocess.Popen([AN,'--host','127.0.0.1','--port','55446','--chain-id','8453','--block-base-fee-per-gas','100000','--gas-price','100000','--disable-min-priority-fee','--mnemonic',mn,'--silent'],env=env,stdout=f,stderr=subprocess.STDOUT,start_new_session=True);children.append(a)
 for _ in range(100):
  assert a.poll() is None,'Owned Anvil exited'
  with socket.socket() as s:
   if s.connect_ex(('127.0.0.1',55446))==0:break
  time.sleep(.1)
 else:raise RuntimeError('Owned Anvil startup deadline')
 f=(W/'harness.private.log').open('xb');h=subprocess.Popen([N,'--import','tsx',str(R/'apps/yunipals-market-api/scripts/native-arena-current-genuine-rpc-local.mjs')],cwd=R/'apps/yunipals-market-api',env=env,stdout=f,stderr=subprocess.STDOUT,start_new_session=True);children.append(h)
 while h.poll() is None:
  if time.monotonic()-started>1500:raise TimeoutError('Owned fixture deadline')
  if os.statvfs(W).f_bavail*os.statvfs(W).f_frsize<2*1024**3:raise RuntimeError('Local 2GiB disk reserve')
  time.sleep(1)
 if h.returncode!=0:raise RuntimeError('Fixture nonzero exit')
 report=json.loads((W/'tmp/arena-lifecycle-report.json').read_text())
 assert report['status']=='passed' and report['providerRequests']==0 and report['mainnetTransactions']==0 and report['realPonderForcedStops']==0
 assert report['rulesHash']=='0x46a4dc89a248047d27c6b02d208c5d2866e843280ef2803294384850edb06c80'
 result.update({'passed':True,'report':report})
except BaseException as exc:
 error=type(exc).__name__;result.update({'errorClass':error,'errorCode':str(exc) if str(exc) in ['Fixture nonzero exit','Owned fixture deadline','Local 2GiB disk reserve'] else 'local_fixture_failure'})
finally:
 for child in reversed(children):
  if child.poll() is None:
   os.killpg(child.pid,signal.SIGTERM)
   try:child.wait(timeout=20)
   except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=5)
 # Exact private schema was absent initially and only this harness used it.
 cleanup="""import pg from'pg';const p=new pg.Pool({connectionString:process.env.ARENA_TEST_DATABASE_URL});try{await p.query('DROP SCHEMA IF EXISTS yunipals_arena CASCADE');console.log(JSON.stringify({operationalSchemaRemoved:true}));}finally{await p.end();}"""
 try:
  c=subprocess.run([N,'--input-type=module','-e',cleanup],cwd=R/'apps/yunipals-market-api',env=env,capture_output=True,check=True,timeout=15);(W/'cleanup.json').write_bytes(c.stdout)
 except BaseException as exc:result['cleanupErrorClass']=type(exc).__name__
 result['elapsedSeconds']=round(time.monotonic()-started,3);result['children']=[{'pid':c.pid,'exitCode':c.returncode} for c in children]
 (W/'result.json').write_text(json.dumps(result,sort_keys=True,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='report'}))
if not result['passed']:raise SystemExit(1)
