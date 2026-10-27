// Official owner evaluated against an inert recorder. No SQL/network executed.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const pinned=(name,digest)=>{const raw=readFileSync(path.join(root,name));assert.equal(sha(raw),digest,name);return JSON.parse(raw);};
const oldSchema='yunipals_ownership_35cdcb32_v3',readSchema='yunipals_ownership_35cdcb32_v4';
const oldIdentity='0xe7119a18273d9a98cc1dcb0bbcad4928e9de72dbd42735b4fbad61a706de3fcc';
const [flag,artifactDirectory,outFlag,output]=process.argv.slice(2);
assert.equal(flag,'--artifact-directory');assert.equal(outFlag,'--out');assert.ok(path.isAbsolute(artifactDirectory));assert.ok(path.isAbsolute(output));assert.equal(existsSync(output),false);
const artifactRaw=readFileSync(path.join(artifactDirectory,'manifest.json'));
assert.equal(sha(artifactRaw),'6f348bf121060215eb889364a233b48a35a8308f10c11b36a4c964a9869cb626');
const artifact=JSON.parse(artifactRaw);
for(const row of artifact.files){const bytes=readFileSync(path.join(artifactDirectory,row.path));assert.equal(bytes.length,row.bytes);assert.equal(sha(bytes),row.sha256);}
for(const row of artifact.inputs)assert.equal(sha(readFileSync(path.join(root,row.path))),row.sha256,row.path);
const previous=pinned('ops/unified-indexer-transition/ownership-readview-plan.review.json','1467b1a604aceb45a20ea593b4a04d750876c7a534359cfce25102597ef8fa59');
const operational=pinned('ops/unified-indexer-transition/consumer-operational-admission-v1.review.json','ff9426e780ca9c6ed302e1a99a09db08b4bdeb7f453fdc9d0f600dc5a45c4db0');
const profile=pinned('docs/unified-indexer/production-rpc-profile-2026-10-20.draft.json','eb32453ec40d043929ba66bc131fc70aad8bf9239a7bdb7258f72067f1bfa1db');
const load=name=>import(pathToFileURL(path.join(root,name)).href);
const identity=await load('packages/yunipals-indexer-server/src/identity.ts');
const {ownershipReadDefinitions}=await load('apps/yunipals-indexer/lib/unified/ownership-config.ts');
const {createOwnershipReadViews}=await load('apps/yunipals-indexer/lib/unified/ownership-views.ts');
const release={id:'0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c',schema:'unified_shadow_20261020_7e7375b0',buildId:'bf4939b3ff',manifestHash:'0x153b9572dafa3b706a5a31a3f2530180639ac2b81abf1d7b15f4c095ef84a029',manifest:profile.manifest};
assert.equal(identity.sourceManifestHash(release.manifest),release.manifestHash);
const definitions=ownershipReadDefinitions(release),statements=[];
const db={async query(sql,params=[]){statements.push({sql,params});if(sql.includes('SELECT value AS app'))return {rows:[{app:{version:'6',build_id:release.buildId,heartbeat_at:1000,is_ready:0,is_locked:0,is_dev:0},checkpoints:[],witnesses:[]}],rowCount:1};if(sql.includes('SELECT id,chain_id,manifest_hash,definition FROM'))return {rows:release.manifest.sources.map(source=>({id:source.id,chain_id:source.chainId,manifest_hash:release.manifestHash,definition:JSON.stringify(source)})),rowCount:release.manifest.sources.length};return {rows:[],rowCount:0};},release(){}};
const created=await createOwnershipReadViews({connect:async()=>db},release,readSchema,definitions);
assert.notEqual(created.identity,oldIdentity);assert.equal(created.created,true);assert.equal(created.activated,false);
const writes=statements.filter(row=>/^\s*(CREATE|INSERT|REVOKE)/.test(row.sql));
for(const row of writes)assert.ok(row.sql.includes('"'+readSchema+'".')||row.sql==='CREATE SCHEMA "'+readSchema+'"');
assert.equal(statements.some(row=>/^\s*(UPDATE|DELETE|DROP|ALTER|GRANT|TRUNCATE)/.test(row.sql)),false);
const normalize=row=>({sql:row.sql.replaceAll(readSchema,oldSchema).replaceAll(created.identity,oldIdentity).replace(/jsonb_set\(e.args::jsonb->'yunipal',\s*'\{rarityScore\}',to_jsonb\(e.args::jsonb->'yunipal'->>'rarityScore'\),false\) AS traits/,"e.args::jsonb->'yunipal' AS traits"),params:row.params.map(value=>typeof value==='string'?value.replaceAll(created.identity,oldIdentity):value)});
assert.deepEqual(writes.map(normalize),previous.expectedOwnerStatements,'Only schema/identity/normalized rarityScore may change.');
const q=name=>{assert.match(name,/^[a-z_][a-z0-9_]*$/);return '"'+name+'"';};
const functionSql=name=>{const match=/^([a-z_]+)\((text|boolean)?\)$/.exec(name);assert.ok(match);return q(readSchema)+'.'+q(match[1])+'('+(match[2]??'')+')';};
const scoped=values=>values.filter(name=>name.startsWith(oldSchema+'.')).map(name=>name.slice(oldSchema.length+1));
const grants=previous.roles.map(prior=>{const extra=operational.remainingReads.find(row=>row.role===prior.role);assert.ok(extra);return {role:prior.role,tables:[...new Set([...scoped(prior.relations),...scoped(extra.relations)])].sort(),functions:[...new Set([...scoped(prior.functions),...scoped(extra.functions)])].sort()};});
grants.push({role:'yunipals_islands_staking',tables:['_unified_read_release','transfer_event'],functions:['source_boundary(text)','source_probe(text)']});
const preconditions=grants.flatMap(row=>[
`IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${row.role}' AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) THEN RAISE EXCEPTION 'existing_restricted_role_required'; END IF;`,
`IF NOT has_schema_privilege('${row.role}','${oldSchema}','USAGE') THEN RAISE EXCEPTION 'existing_schema_read_required'; END IF;`,
...row.tables.map(name=>`IF NOT has_table_privilege('${row.role}','${oldSchema}.${name}','SELECT') THEN RAISE EXCEPTION 'existing_table_read_required'; END IF;`),
...row.functions.map(name=>`IF NOT has_function_privilege('${row.role}','${oldSchema}.${name}','EXECUTE') THEN RAISE EXCEPTION 'existing_function_read_required'; END IF;`)
]);
const grantsSql=`-- Existing finite read closure on a fresh immutable candidate; no role changes.\nBEGIN;\nSET LOCAL lock_timeout='1500ms';\nSET LOCAL statement_timeout='8s';\nDO $v4_grants$ BEGIN\nIF current_database()<>'yunipals_backfill' OR current_user<>'postgres' OR inet_client_addr() IS NOT NULL THEN RAISE EXCEPTION 'local_owner_required'; END IF;\nIF NOT EXISTS(SELECT 1 FROM ${q(oldSchema)}._unified_read_release WHERE singleton AND identity='${oldIdentity}' AND release_id='${release.id}') OR NOT EXISTS(SELECT 1 FROM ${q(readSchema)}._unified_read_release WHERE singleton AND identity='${created.identity}' AND release_id='${release.id}' AND manifest_hash='${release.manifestHash}') THEN RAISE EXCEPTION 'exact_candidate_identities_required'; END IF;\nIF (SELECT count(*) FROM pg_proc WHERE pronamespace='${readSchema}'::regnamespace AND NOT prosecdef AND proconfig=ARRAY['search_path=pg_catalog'])<>4 THEN RAISE EXCEPTION 'four_protected_invokers_required'; END IF;\n${preconditions.join('\n')}\nEND $v4_grants$;\n${grants.map(row=>`GRANT USAGE ON SCHEMA ${q(readSchema)} TO ${q(row.role)};\nGRANT SELECT ON TABLE ${row.tables.map(name=>q(readSchema)+'.'+q(name)).join(',')} TO ${q(row.role)};\nGRANT EXECUTE ON FUNCTION ${row.functions.map(functionSql).join(',')} TO ${q(row.role)};`).join('\n')}\nCOMMIT;\n`;
const result={format:'yunipals-metadata-readview-v4-preparation-v1',reviewOnly:true,artifactDigest:artifact.artifactDigest,artifactManifestSha256:sha(artifactRaw),sourceRelease:release.id,physicalSchema:release.schema,buildId:release.buildId,readSchema,readIdentity:created.identity,previousReadSchema:oldSchema,previousReadIdentity:oldIdentity,definitions,expectedOwnerStatements:writes,expectedOwnerStatementsSha256:sha(encode(writes)),ddlDifference:'schema_and_identity_and_rarity_score_string_only',grants,grantsSha256:sha(grantsSql),ownerCommand:{cwd:artifact.requiredWorkingDirectory,executable:'/opt/node-v24.18.1/bin/node',argv:['/opt/yunipals-unified/nonmarket-consumer-releases/'+artifact.artifactDigest+'/dist/unified-ownership-views.mjs'],environment:{UNIFIED_INDEXER_DATABASE_URL:'postgresql:///yunipals_backfill?host=/var/run/postgresql&port=5432&user=postgres',UNIFIED_INDEXER_RELEASE_ID:release.id,UNIFIED_INDEXER_READ_SCHEMA:readSchema},unixIdentity:'postgres'},previousSchemaModified:false,physicalTablesModified:false,rolesOrLoginChanged:false,servicesOrSelectorsChanged:false,databaseConnections:0,providerRequests:0};
mkdirSync(output);writeFileSync(path.join(output,'plan.json'),encode(result),{flag:'wx'});writeFileSync(path.join(output,'grants.sql'),grantsSql,{flag:'wx'});console.log(JSON.stringify({prepared:true,readSchema,readIdentity:created.identity,ownerStatements:writes.length,grantRoles:grants.map(row=>row.role),files:['plan.json','grants.sql'].map(name=>({name,sha256:sha(readFileSync(path.join(output,name)))})),directory:output,databaseConnections:0,providerRequests:0}));
