// One isolated real-PG classifier fixture; native status/OIDs remain explicit seams.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const hash=(raw)=>createHash('sha256').update(raw).digest('hex');
const base=readFileSync(join(here,'arena-native-derived-projector-v1.postgres.test.mjs'),'utf8');
assert.equal(hash(base),'198244dc552c99fb736dd2b1dfc0e49d478cfdfed40fb9a7e53971f5a8d2e6f3');
assert.equal(hash(readFileSync(join(here,'arena-native-derived-projector-current-v1.mjs'))),
  '4c33f644480a5c2ccf05ecc0a6b2b2a9390f85e46a25ded902c116619b7605f7');
assert.equal(process.env.ARENA_DERIVED_FIXTURE_URL,'postgresql://postgres@127.0.0.1:56983/fixture');
const end=base.indexOf('  await event(3,"Claimed"');
assert.ok(end>0);let source=base.slice(0,end);
source=source.replace('import { projectBatch, inspectCurrent }',
  "import * as projector from './arena-native-derived-projector-v1.mjs';\nimport {classify,eligible} from './arena-native-derived-projector-current-v1.mjs';\nimport {createHash} from 'node:crypto';\nimport { projectBatch, inspectCurrent }");
for(const [old,next]of [['ypal_native_derived_fixture','ypal_current_classifier_source'],
  ['ypal_public_derived_fixture','ypal_current_classifier_public'],['ypal_derived_fixture_owner','ypal_current_classifier_owner'],
  ['ypal_derived_fixture_writer','ypal_current_classifier_writer'],['ypal_derived_fixture_reader','ypal_current_classifier_reader']])
  source=source.replaceAll(old,next);
const artifactBlock=`  const artifact=await buildArtifact(root);mkdirSync(join(temporary,"dist"));
  for(const [name,raw]of Object.entries(artifact.outputs))writeFileSync(join(temporary,name),raw);`;
assert.equal(source.split(artifactBlock).length,2);
source=source.replace(artifactBlock,`  mkdirSync(join(temporary,"dist"));
  const acceptedFacade=readFileSync('/tmp/arena-native-derived-support-credentials-v2-20261025/dist/arena-inverse-support.mjs');
  assert.equal(createHash('sha256').update(acceptedFacade).digest('hex'),'08905983dc0f5556190d311fd648eecc9ebfea4c958e607902a93ac7a2ad24ba');
  writeFileSync(join(temporary,'dist/arena-inverse-support.mjs'),acceptedFacade);`);
source=source.replace('  for(const status of ["advanced","advanced","caught-up"]){',
  '  let savedTarget;\n  for(const status of ["advanced","advanced","caught-up"]){');
const after='    assert.equal(batch.boundaryWitnessKind,status==="caught-up"?"retained-chain-block":"complete-native-event-block");';
assert.equal(source.split(after).length,2);
source=source.replace(after,after+`\n    if(status==='advanced')savedTarget=(await targetAdmin.query("SELECT contract,start_block::text,cursor::text,cursor_hash,finalized_at,indexer_mode,halted FROM yunipals_arena.deployment WHERE id=$1",[deployment])).rows[0];`);
source+=`
  savedTarget=(await targetAdmin.query("SELECT contract,start_block::text,cursor::text,cursor_hash,finalized_at,indexer_mode,halted FROM yunipals_arena.deployment WHERE id=$1",[deployment])).rows[0];
  await event(3,'Claimed',{player:wallet,amount:'1000000'});complete=floor+3n;
  await sourceAdmin.query('UPDATE '+schema+'.arena_credit SET amount=1000000');
  assert.equal((await projectBatch(support,source,writer,config)).status,'caught-up');
  await sourceAdmin.query('DELETE FROM '+schema+'.chain_block WHERE block_number<$1',[String(complete)]);
  const failed={native:{complete:String(complete),frameworkReady:true,running:true},target:savedTarget};
  assert.equal(savedTarget.cursor,String(floor+2n));
  assert.equal(eligible(Error('fresh_derived_cursor_must_equal_current_native_complete_boundary'),failed),true);
  const qualified=await classify(projector,support,source,reader,config,failed);
  assert.equal(qualified.pureLagQualified,true);assert.equal(qualified.fullPrefixEvents,4);
  assert.equal(qualified.sampledTargetCursor,String(floor+2n));assert.equal(qualified.observedTargetCursor,String(complete));
  assert.equal(qualified.progressFloor,String(complete));
  await sourceAdmin.query('UPDATE '+schema+".canonical_event SET args='{}' WHERE name='Entered'");
  await assert.rejects(classify(projector,support,source,reader,config,failed),/entire_projected_prefix_must_be_canonical/);
  await sourceAdmin.query('UPDATE '+schema+".canonical_event SET args=$1 WHERE name='Entered'",[{id:'1',seat:0,player:wallet,nftChainId:8453,collection:wallet,tokenId:'1'}]);
  await targetAdmin.query('UPDATE yunipals_arena.deployment SET cursor_hash=$1',[HASH(999)]);
  await assert.rejects(classify(projector,support,source,reader,config,failed),/both_sampled_and_current_public_boundary_hashes/);
  await targetAdmin.query('UPDATE yunipals_arena.deployment SET cursor_hash=$1',[HASH(103)]);
  await sourceAdmin.query('UPDATE '+schema+'.chain_block SET block_hash=$1 WHERE block_number=$2',[HASH(999),String(complete)]);
  await assert.rejects(classify(projector,support,source,reader,config,failed),/actual_canonical_classification_boundary/);
  await sourceAdmin.query('UPDATE '+schema+'.chain_block SET block_hash=$1 WHERE block_number=$2',[HASH(103),String(complete)]);
  await targetAdmin.query("UPDATE yunipals_arena.deployment SET finalized_at=now()-interval '10 minutes'");
  await assert.rejects(classify(projector,support,source,reader,config,failed),/fresh_nonrewinding_public_cursor/);
  report={classifierFixtureGroups:1,realSQLRefusals:4,wholeOriginalMutationSuiteRepeated:false,
    actualFrozenFacadeSha256:'08905983dc0f5556190d311fd648eecc9ebfea4c958e607902a93ac7a2ad24ba',
    actualCurrentNodeSha256:'4c33f644480a5c2ccf05ecc0a6b2b2a9390f85e46a25ded902c116619b7605f7',
    genuineOfficialReducerAndFourTableACLs:true,savedPrunedBlockUsesActualCanonicalEventWitness:true,
    nativeFrameworkStatusAndPhysicalOIDFixtures:true,providerCalls:0,productionAccess:0};
`+base.slice(base.indexOf('}finally{'));
const file=join(here,'.current-classifier-fixture-'+process.pid+'.mjs');
writeFileSync(file,source,{mode:0o600,flag:'wx'});
try{await import(pathToFileURL(file).href);}finally{unlinkSync(file);}
