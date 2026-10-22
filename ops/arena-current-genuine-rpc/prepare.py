from pathlib import Path
import hashlib, importlib.util, json, os
R=Path('/tmp/yunipals-arena-live-compat-20261022')
O=R/'ops/arena-current-genuine-rpc'
spec=importlib.util.spec_from_file_location('frozen_v10','/root/yunipals/ops/unified-indexer-transition/arena-genuine-rpc-v10.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def once(s,a,b):
 assert s.count(a)==1,a
 return s.replace(a,b)
def save(p,data):
 p.parent.mkdir(parents=True,exist_ok=True)
 with p.open('xb') as f:f.write(data)
raw=(R/'apps/yunipals-market-api/scripts/native-arena-anvil.mjs').read_bytes()
s=m.transformed_harness(raw).decode()
s=once(s,'arena-rpc-postgres.mjs','arena-rpc-postgres-current-local.mjs')
s=once(s,'import { randomBytes } from "node:crypto";','import { randomBytes, randomUUID } from "node:crypto";')
s=once(s,'import { NativeArenaSource } from "../src/arena/live/nativeSource.ts";','import { NativeArenaSource } from "../src/arena/live/nativeSource.ts";\nimport { selectedArenaRuntimeSource } from "../src/arena/live/selectedSourceRuntime.ts";')
s=once(s,'  const report = {','''  // Actual selected-source restart binding using this real Ponder release.
  // The entire operational schema belongs to this isolated fixture and is
  // removed by its caller after all immutable-ledger assertions complete.
  const selectionBlock = await client.getBlock({blockTag:"latest"});
  const selectionEpoch = randomUUID(), selectionReview = "0x" + sha256("current-genuine-source-selection");
  await transaction(pool, async db => {
    await db.query("UPDATE yunipals_arena.deployment SET halted=true WHERE id=$1", [deployment]);
    const review = {previous:null,target:{kind:"unified",sourceId:source.release.id},accepted:{block:String(selectionBlock.number),hash:selectionBlock.hash}};
    await db.query("INSERT INTO yunipals_arena.source_switch_history(epoch,deployment,review_hash,review) VALUES($1,$2,$3,$4)",[selectionEpoch,deployment,selectionReview,JSON.stringify(review)]);
    await db.query("INSERT INTO yunipals_arena.source_selection(deployment,epoch,kind,source_id,accepted_block,accepted_hash,review_hash) VALUES($1,$2,'unified',$3,$4,$5,$6)",[deployment,selectionEpoch,source.release.id,String(selectionBlock.number),selectionBlock.hash,selectionReview]);
    await db.query("UPDATE yunipals_arena.deployment SET halted=false WHERE id=$1",[deployment]);
  });
  await assert.rejects(service.ready(), /source epoch changed/);
  const selected = await selectedArenaRuntimeSource({pool,sourcePool:source.readPool,native:{mode:"unified",sourceKind:"unified",releaseId:source.release.id,databaseUrl:sourceUrl},deployment:{id:deployment,contract:arena.address,startBlock:arena.block},base:client});
  const selectedService = new ArenaIntake(pool,deployment,arena.address,"https://www.yunipals.com",cipher,{message:input=>client.verifyMessage(input),strategy:input=>client.verifyTypedData(input)},selected.nativeSource,selected.binding);
  await selectedService.ready();
  await assert.rejects(selectedArenaRuntimeSource({pool,sourcePool:source.readPool,native:{mode:"unified",sourceKind:"unified",releaseId:"0x"+"66".repeat(32),databaseUrl:sourceUrl},deployment:{id:deployment,contract:arena.address,startBlock:arena.block},base:client}), /does not match/);
  const selectedSnapshot = await durablePrivateSnapshot();
  await source.restart();
  await selectedService.ready();
  await new NativeArenaDisclosure(selectedService,observed=>verifyNativeArenaAction(client,observed)).tick();
  assert.equal(await durablePrivateSnapshot(),selectedSnapshot);
  const sourceSelectionRecovery = {actualImmutableReview:true,unboundOldActorRefused:true,wrongSourceStartupRefused:true,matchingRestartRecovered:true,privateSnapshotSha256:selectedSnapshot};
  const report = {''')
s=once(s,'    actualPonderBuild, actualPonderManifest,','    actualPonderBuild, actualPonderManifest,\n    rulesHash:catalog.rulesHash,sourceSelectionRecovery,')
# Reviewed selected deployment cannot be destructively erased through ordinary
# row DML. Caller owns and removes this complete synthetic schema after close.
s=once(s,'  if (deployment) {','  if (deployment && !(await pool.query("SELECT 1 FROM yunipals_arena.source_selection WHERE deployment=$1",[deployment])).rowCount) {')
s=once(s,'  console.log(JSON.stringify(report));','  console.log(JSON.stringify(report));')
harness=R/'apps/yunipals-market-api/scripts/native-arena-current-genuine-rpc-local.mjs'
save(harness,s.encode())
a=(R/'apps/yunipals-indexer/scripts/fixtures/arena-rpc-postgres.mjs').read_text()
a=once(a,'"./unified-rpc-project.mjs"','"./unified-rpc-project-current-local.mjs"')
a=once(a,'"no_proxy", "NODE_EXTRA_CA_CERTS",','"no_proxy", "NODE_OPTIONS", "PONDER_TELEMETRY_DISABLED", "NODE_EXTRA_CA_CERTS",')
save(R/'apps/yunipals-indexer/scripts/fixtures/arena-rpc-postgres-current-local.mjs',a.encode())
p=(R/'apps/yunipals-indexer/scripts/fixtures/unified-rpc-project.mjs').read_text()
p=once(p,'JSON.stringify([repository, directory])','JSON.stringify([repository, directory, "/root/yunipals"])')
save(R/'apps/yunipals-indexer/scripts/fixtures/unified-rpc-project-current-local.mjs',p.encode())
# Four bounded compiled fixture artifacts, no dependency or source copy.
for src in (Path('/tmp/yunipals-arena-public-fixtures-20261021/contracts/arena/out')).glob('*/*.json'):
 target=R/'contracts/arena/out'/src.relative_to(src.parents[1]);target.parent.mkdir(parents=True,exist_ok=True)
 if not target.exists():target.symlink_to(src)
png=Path('/root/yunipals/docs/islands/arena-artwork-production-v2/https-releases/4d50ebe8ec0d1ae8c0b9b9f94ad3daef21a7235b06d07df2412fb33c139fc1f9/public/images/195.png')
target=R/png.relative_to('/root/yunipals');target.parent.mkdir(parents=True,exist_ok=True)
if not target.exists():target.symlink_to(png)
print(json.dumps({'harness':str(harness),'harnessSha256':hashlib.sha256(s.encode()).hexdigest(),'businessSourceChanged':False,'providerCalls':0}))
