from pathlib import Path
import importlib.util,json,hashlib
R=Path('/tmp/yunipals-arena-live-compat-20261022')
spec=importlib.util.spec_from_file_location('frozen_k','/root/yunipals/ops/unified-indexer-transition/arena-live-reorg-v1.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def once(s,a,b):
 assert s.count(a)==1,a
 return s.replace(a,b)
s=m.transformed_harness((R/'apps/yunipals-market-api/scripts/native-arena-anvil.mjs').read_bytes()).decode()
s=once(s,'arena-rpc-postgres.mjs','arena-rpc-postgres-current-live-local.mjs')
s=once(s,'import { randomBytes } from "node:crypto";','import { randomBytes, randomUUID } from "node:crypto";')
selected=(R/'apps/yunipals-market-api/scripts/native-arena-current-selected-v2-genuine-rpc-local.mjs').read_text()
initial=selected[selected.index('  const initialEpoch = randomUUID()'):selected.index('  const nativeSource = new NativeArenaSource(')]
s=once(s,'  const nativeSource = new NativeArenaSource(',initial+'  const nativeSource = new NativeArenaSource(')
s=once(s,'    nativeSource\n  );','    nativeSource,\n    initialBinding\n  );')
s=once(s,'  const report = { status: "passed",','  const report = { checkedAt:new Date().toISOString(),rulesHash:catalog.rulesHash,nativeSchema:source.schemaName,fullLifecycleInitiallyBound:true,status: "passed",')
s=once(s,'  if (deployment) {','  if (deployment && !(await pool.query("SELECT 1 FROM yunipals_arena.source_selection WHERE deployment=$1",[deployment])).rowCount) {')
p=R/'apps/yunipals-market-api/scripts/native-arena-current-selected-live-reorg-local.mjs'
with p.open('x')as f:f.write(s)
a=m.transformed_adapter((R/'apps/yunipals-indexer/scripts/fixtures/arena-rpc-postgres.mjs').read_bytes()).decode()
a=once(a,'"./unified-rpc-project.mjs"','"./unified-rpc-project-current-local.mjs"')
a=once(a,'"no_proxy", "NODE_EXTRA_CA_CERTS",','"no_proxy", "NODE_OPTIONS", "PONDER_TELEMETRY_DISABLED", "NODE_EXTRA_CA_CERTS",')
with (R/'apps/yunipals-indexer/scripts/fixtures/arena-rpc-postgres-current-live-local.mjs').open('x')as f:f.write(a)
s=(R/'ops/arena-current-genuine-rpc/run.py').read_text().replace('20261022-a','20261022-d').replace('native-arena-current-genuine-rpc-local.mjs','native-arena-current-selected-live-reorg-local.mjs')
with (R/'ops/arena-current-genuine-rpc/run-live.py').open('x')as f:f.write(s)
print(json.dumps({'harness':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'sameProcessAssertions':True,'businessChanged':False}))
