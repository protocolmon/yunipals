// Offline successor: reproduce all original outputs, then change only parsing.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildArtifact as originalBuild } from "./arena-native-derived-support-build-v1.mjs";

const HERE=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(HERE,"../..");
const sha=(raw)=>createHash("sha256").update(raw).digest("hex");
const encoded=(value)=>Buffer.from(JSON.stringify(value,null,2)+"\n");
export const ORIGINAL_BUILDER_SHA="54c1802082898283d7033ef61dd440cd98da20449162fcb414cbf6477794f4b1";
export const ORIGINAL_MANIFEST_SHA="19a9a5737c153192c0723aa73c3d3f4e119f2492cb775ac617a63b0b57bbaf5e";
export const ORIGINAL_ARTIFACT="a330c3f1ba2701ba287f0675b0c6c11ca010e85d504d5e8798df574625972f67";
export const ORIGINAL_RUNTIME_SHA="8c598c9ae4c6b7b07c2a4ebaf6fc5d2d4ae64c84c5578a2919fee6c579f92a89";

export function credentialRuntime(raw,parser) {
  assert.equal(sha(raw),ORIGINAL_RUNTIME_SHA);
  const old=`      const rows = credential.toString("utf8").trim().split("\\n");
      need(rows.length === 1 && rows[0].startsWith(key + "="), "one_exact_existing_credential_key_required");
      config[field] = rows[0].slice(key.length + 1);`;
  const text=raw.toString("utf8");assert.equal(text.split(old).length,2);
  assert.equal(parser.toString("utf8").split("export function existingCredentialUrl(").length,2);
  return Buffer.from(parser.toString("utf8")+"\n"+text.replace(old,
    '      config[field] = existingCredentialUrl(credential, key, config.native.releaseId, name === "native.env");'));
}

export async function buildArtifact(tree=root) {
  const folder=path.join(tree,"ops/unified-indexer-transition");
  assert.equal(sha(readFileSync(path.join(folder,"arena-native-derived-support-build-v1.mjs"))),ORIGINAL_BUILDER_SHA);
  const previous=await originalBuild(tree);assert.equal(sha(encoded(previous.manifest)),ORIGINAL_MANIFEST_SHA);
  assert.equal(previous.manifest.artifactDigest,ORIGINAL_ARTIFACT);
  const parserName="ops/unified-indexer-transition/arena-native-derived-credentials-v2.mjs";
  const parser=readFileSync(path.join(tree,parserName));
  const outputs={...previous.outputs,"dist/arena-native-derived-projector-v1.mjs":credentialRuntime(previous.outputs["dist/arena-native-derived-projector-v1.mjs"],parser)};
  const manifest={...previous.manifest,format:"yunipals-arena-native-derived-support-artifact-v2",
    builderSha256:sha(readFileSync(fileURLToPath(import.meta.url))),predecessorArtifactDigest:ORIGINAL_ARTIFACT,
    predecessorManifestSha256:ORIGINAL_MANIFEST_SHA,originalServiceAndWireProtocolRetained:true,
    credentialParserOnlyChange:true,nativeCredentialKeys:["ARENA_INDEXER_MODE","ARENA_INDEXER_SOURCE_KIND","ARENA_INDEXER_RELEASE_ID","ARENA_INDEXER_DATABASE_URL"],
    inputs:[...previous.manifest.inputs,{path:parserName,bytes:parser.length,sha256:sha(parser),acceptedSha256:null,newSupport:true}],
    files:Object.entries(outputs).map(([name,data])=>({path:name,bytes:data.length,sha256:sha(data)}))};
  delete manifest.artifactDigest;manifest.artifactDigest=sha(encoded(manifest));return{manifest,outputs};
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const args=process.argv.slice(2);
  if(!args.length)console.log(JSON.stringify({staticOnly:true,databaseWrites:0,providerCalls:0,servicesChanged:0}));
  else{
    assert.equal(args.length,2);assert.equal(args[0],"--out");assert.ok(path.isAbsolute(args[1])&&!existsSync(args[1]));
    const {manifest,outputs}=await buildArtifact();mkdirSync(args[1]);mkdirSync(path.join(args[1],"dist"));
    for(const[name,raw]of Object.entries(outputs))writeFileSync(path.join(args[1],name),raw,{flag:"wx",mode:0o644});
    writeFileSync(path.join(args[1],"manifest.json"),encoded(manifest),{flag:"wx",mode:0o644});
    console.log(JSON.stringify({artifactDigest:manifest.artifactDigest,manifestSha256:sha(encoded(manifest)),files:manifest.files.length,inputs:manifest.inputs.length}));
  }
}
