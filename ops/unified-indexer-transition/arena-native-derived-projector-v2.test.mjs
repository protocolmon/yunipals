// Synthetic credentials and offline compilation only; no runtime or DB effects.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { existingCredentialUrl } from "./arena-native-derived-credentials-v2.mjs";
import { buildArtifact, credentialRuntime } from "./arena-native-derived-support-build-v2.mjs";

const HERE=path.dirname(fileURLToPath(import.meta.url));
const sha=(raw)=>createHash("sha256").update(raw).digest("hex");
const encoded=(value)=>Buffer.from(JSON.stringify(value,null,2)+"\n");
const fixture=JSON.parse((await promisify(execFile)("python3",["-I","-B","-c",`
import importlib.util,json
p=${JSON.stringify(path.join(HERE,"arena-ypal-native-v2.credentials.py"))}
s=importlib.util.spec_from_file_location('synthetic_emitter',p)
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
print(json.dumps({'release':m.RELEASE_ID,'native':m.content({'group':'source','role':'arena_native_reader'},'S'*48).decode()}))
`],{encoding:"utf8"})).stdout);
const native=Buffer.from(fixture.native),key="ARENA_INDEXER_DATABASE_URL";

await test("actual original emitter four-key form and public one-key form",()=>{
  const url=existingCredentialUrl(native,key,fixture.release,true);
  assert.equal(url,fixture.native.trim().split("\n")[3].slice(key.length+1));
  assert.equal(existingCredentialUrl(Buffer.from("ARENA_PUBLIC_ROLLBACK_DATABASE_URL=postgresql://synthetic-only\n"),"ARENA_PUBLIC_ROLLBACK_DATABASE_URL",fixture.release,false),"postgresql://synthetic-only");
});

await test("unknown, missing, duplicated and foreign selectors refuse",()=>{
  for(const raw of [fixture.native.replace("MODE=unified","MODE=legacy"),fixture.native.replace("SOURCE_KIND=unified","SOURCE_KIND=legacy"),
    fixture.native.replace(fixture.release,"0x"+"0".repeat(64)),fixture.native+"EXTRA=1\n",fixture.native.split("\n").slice(1).join("\n"),
    fixture.native.replace(key,"FOREIGN_DATABASE_URL"),fixture.native.slice(0,fixture.native.indexOf(key))+key+"=\n",fixture.native.replaceAll("\n","\r\n")]){
    assert.throws(()=>existingCredentialUrl(Buffer.from(raw),key,fixture.release,true));
  }
  assert.throws(()=>existingCredentialUrl(native,key,"invalid",true));
  assert.throws(()=>existingCredentialUrl(native,"FOREIGN_DATABASE_URL",fixture.release,true));
  assert.throws(()=>existingCredentialUrl(Buffer.from("ARENA_PUBLIC_ROLLBACK_DATABASE_URL=\n"),"ARENA_PUBLIC_ROLLBACK_DATABASE_URL",fixture.release,false));
});

await test("runtime changes exactly the credential parser and retains all other bytes",()=>{
  const raw=readFileSync(path.join(HERE,"arena-native-derived-projector-v1.mjs"));
  const parser=readFileSync(path.join(HERE,"arena-native-derived-credentials-v2.mjs"));
  const result=credentialRuntime(raw,parser);
  const old=`      const rows = credential.toString("utf8").trim().split("\\n");\n      need(rows.length === 1 && rows[0].startsWith(key + "="), "one_exact_existing_credential_key_required");\n      config[field] = rows[0].slice(key.length + 1);`;
  const current='      config[field] = existingCredentialUrl(credential, key, config.native.releaseId, name === "native.env");';
  assert.deepEqual(result,Buffer.from(parser.toString()+"\n"+raw.toString().replace(old,current)));
  assert.equal(sha(result),"37c17e1bdaf22bfecd930ff97da8e6eb7b8337f57469cb16d487e0f6c77be319");
  assert.throws(()=>credentialRuntime(Buffer.concat([raw,Buffer.from("\n")]),parser));
});

await test("actual artifact reproducible with all original inputs and identical facade/map",async()=>{
  const result=await buildArtifact();
  const manifest=JSON.parse(readFileSync(path.join(HERE,"arena-native-derived-support-v2.manifest.json")));
  assert.deepEqual(result.manifest,manifest);
  assert.equal(sha(encoded(result.manifest)),"b038bff5a579d08fbd0ebcce4765029d52465f50c854b033b9191c4ecabf1443");
  assert.equal(manifest.artifactDigest,"8b94c5c50da8adc1673e7d3971a374e8fef54c7c4f98323b8bd49ce72b542a99");
  assert.equal(manifest.inputs.length,50);assert.equal(manifest.files.length,3);
  for(const row of manifest.files){assert.equal(sha(result.outputs[row.path]),row.sha256);assert.equal(result.outputs[row.path].length,row.bytes);}
  const prior=JSON.parse(readFileSync(path.join(HERE,"arena-native-derived-support-v1.manifest.json")));
  for(const name of["dist/arena-inverse-support.mjs","dist/arena-inverse-support.mjs.map"]){
    assert.deepEqual(manifest.files.find(row=>row.path===name),prior.files.find(row=>row.path===name));
  }
});
