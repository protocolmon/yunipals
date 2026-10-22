#!/usr/bin/env python3
"""Local artifact/invariant controls; no build, provider, database or host call."""
import ast
import copy
import io
import json
from pathlib import Path
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
ROOT = HERE.parents[1]

def module(name):
    path = HERE / name
    value = types.ModuleType(path.stem); value.__file__ = str(path)
    exec(compile(path.read_bytes(), str(path), "exec"), value.__dict__)
    return value

m = module("arena-modern-package-v1.py")
old = module("arena-credential-package-v2.py")
p = module("source6-package-v3.py")
h = module("../unified-indexer/runtime-supplement.py")


def overlay_fixture():
    patches = {f"scripts/arena/fixture-{i}.txt": b"public" for i in range(1000)}
    patches.update({name: b"public acceptance" for name in m.ACCEPTANCE_FILES})
    rows = [{"path": name, "bytes": len(raw), "sha256": m.sha(raw), "mode": 0o644} for name, raw in sorted(patches.items())]
    manifest = {"format": "arena-live-compat-public-overlay-v1", "expectedRulesHash": m.RULES_HASH, "expectedBundleCount": 36, "files": rows}
    return manifest, patches


def archive_of(manifest, patches, extra=None):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w:gz") as tar:
        values = {**patches, "arena-live-compat-overlay-manifest.json": m.encoded(manifest)}
        for name, raw in values.items():
            info = tarfile.TarInfo(name); info.size = len(raw); info.mode = 0o644
            tar.addfile(info, io.BytesIO(raw))
        if extra is not None:
            tar.addfile(extra, io.BytesIO(b"x") if extra.isfile() else None)
    return stream.getvalue()


def runtime_pair():
    source = "apps/yunipals-market-api/src/arena/live/fixture.ts"
    paths = [m.DIST + "rpc-budget-proxy.mjs", m.DIST + "server.mjs", *[m.DIST + f"arena-old-{i}.mjs" for i in range(32)]]
    entries = [{"path": "node_modules/.pnpm/package-" + str(i), "type": "directory", "mode": 0o755} for i in range(330)]
    for name in paths:
        entries.extend({"path": suffix, "type": "file", "mode": 0o644, "bytes": 1, "sha256": "a" * 64} for suffix in [name, name + ".map"])
    entries.extend({"path": "node_modules/dependency/file-" + str(i), "type": "file", "mode": 0o644, "bytes": 1, "sha256": "a" * 64} for i in range(60918-len(entries)))
    proof = lambda names: [{"path": name, "sha256": "a" * 64, "sourceMapSha256": "a" * 64, "sourcePaths": [source]} for name in names]
    before = {"roots": ["node_modules", m.DIST.rstrip("/")], "entries": entries, "bundleProof": {"allSourceContentsMatch": True, "bundles": proof(paths)}}
    after = copy.deepcopy(before)
    for name in sorted(m.NEW_BUNDLES):
        after["entries"].extend({"path": suffix, "type": "file", "mode": 0o644, "bytes": 1, "sha256": "a" * 64} for suffix in [name, name + ".map"])
        after["bundleProof"]["bundles"].extend(proof([name]))
    a = {"files": [{"path": source, "bytes": 1, "sha256": "a" * 64}]}
    b = {"files": [{"path": source, "bytes": 1, "sha256": "b" * 64}]}
    return before, after, a, b


class Tests(unittest.TestCase):
    def test_exact_pinned_helpers_and_copied_safety_bodies(self):
        for path, pin in [("arena-credential-package-v2.py", m.CREDENTIAL_HELPER_SHA), ("source6-package-v3.py", m.PRIMITIVES_SHA), ("../unified-indexer/runtime-supplement.py", m.RUNTIME_HELPER_SHA)]:
            self.assertEqual(m.sha((HERE/path).read_bytes()), pin)
        trees = [ast.parse((HERE/name).read_bytes()) for name in ["arena-modern-package-v1.py", "arena-credential-package-v2.py"]]
        classes = [next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "Build") for tree in trees]
        for name in ["guard", "stop_child", "run", "runtime_args"]:
            self.assertEqual(*[ast.dump(next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == name)) for cls in classes])

    def test_real_overlay_archive_roundtrip_and_complete_21check_sources(self):
        manifest, patches = overlay_fixture()
        self.assertEqual(m.overlay_payload(manifest, archive_of(manifest, patches)), patches)
        for name in m.ACCEPTANCE_FILES:
            wrong = copy.deepcopy(manifest); wrong["files"] = [r for r in wrong["files"] if r["path"] != name]
            with self.assertRaises(m.PackageFailure): m.overlay_payload(wrong, archive_of(wrong, {k:v for k,v in patches.items() if k!=name}))

    def test_archive_extra_duplicate_symlink_traversal_and_hash_drift_refused(self):
        manifest, patches = overlay_fixture()
        for name, kind in [("extra.ts", "file"), (next(iter(patches)), "file"), ("link.ts", "link"), ("../escape.ts", "file")]:
            extra = tarfile.TarInfo(name); extra.mode=0o644
            if kind == "link": extra.type=tarfile.SYMTYPE; extra.linkname="/private"
            else: extra.size=1
            with self.assertRaises(m.PackageFailure): m.overlay_payload(manifest, archive_of(manifest, patches, extra))
        wrong = dict(patches); wrong[next(iter(wrong))] = b"changed"
        with self.assertRaises(m.PackageFailure): m.overlay_payload(manifest, archive_of(manifest, wrong))

    def test_only_five_exact_public_media_paths_allowed(self):
        self.assertEqual(len(m.PUBLIC_MEDIA),5)
        for name in m.PUBLIC_MEDIA: self.assertEqual(m.source_path(name),name)
        for name in ["docs/other.img","docs/other.mp3",m.PUBLICATION+"/images/1.png",".env","apps/dist/private.key","../escape.ts","node_modules/pkg/file.ts"]:
            with self.assertRaises(m.PackageFailure):m.source_path(name)

    def test_actual_frozen_1293_overlay_composes_exact_1796_candidate(self):
        overlay_path=Path("/tmp/yunipals-arena-live-compat-build-overlay-20261022.tar.gz")
        manifest_path=Path("/tmp/yunipals-arena-live-compat-20261022/docs/unified-indexer/arena-live-compat-build-overlay-manifest-2026-10-22.json")
        if not overlay_path.is_file() or not manifest_path.is_file(): self.skipTest("Retained external frozen1293 public artifact is required for this integration control.")
        self.assertEqual(m.sha(overlay_path.read_bytes()),"4975231a4a19ebbb32490a255e1e9f532f3593cb422b5fed1371922829d2505b")
        self.assertEqual(m.sha(manifest_path.read_bytes()),"a7ec13c29a7af5f37390fffabd27ce7c1b9aa8f8bb1b254f8fafe32123b13393")
        patches=m.overlay_payload(json.loads(manifest_path.read_bytes()),overlay_path.read_bytes())
        base_path=ROOT/"ops/unified-indexer-transition/frozen-baseline-source"/m.BASE_DIGEST/"source.tar.gz"
        with tarfile.open(base_path,"r:gz")as tar:before=json.load(tar.extractfile("./RELEASE-MANIFEST.json"))
        candidate=m.candidate_manifest(before,patches)
        self.assertEqual(len(candidate["files"]),1796)
        self.assertEqual(candidate["sourceDigest"],"264a33229f4c47c004362d264fa90f670784b70be8a6ec6d82187cc7e987ae24")
        self.assertEqual(m.sha(m.encoded(candidate)),"fe6a122bd9dbac6614ff2126db2010a4f73bc54921f8dc40109a9c850ee3eb3e")
        rows={r["path"]:r for r in candidate["files"]}
        for name,pin in old.PATCHES.items():
            if not name.endswith("/config.ts"):self.assertEqual(rows[name]["sha256"],pin)
        with tempfile.TemporaryDirectory()as directory:
            base=Path(directory)
            with tarfile.open(base_path,"r:gz")as tar:
                for name in patches:
                    if Path(name).name=="package.json":
                        path=base/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(tar.extractfile("./"+name).read())
            m.dependency_inputs(base,before,patches,p)
            with tarfile.open(base_path,"r:gz")as tar:
                for name in ["RELEASE-MANIFEST.json","SHA256SUMS",*[row["path"]for row in before["files"]]]:
                    path=base/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(tar.extractfile("./"+name).read())
            candidate_root=base/"candidate";p.copy_source(base,candidate_root,before)
            m.prepare_patch_parents(candidate_root,patches);p.patch_source(candidate_root,candidate,patches)
            self.assertEqual(h.source_check(candidate_root,candidate["sourceDigest"]),candidate)
            self.assertTrue((candidate_root/m.ACCEPTANCE/"run.ts").is_file())

    def test_new_patch_parents_are_created_but_symlinks_and_non_directory_parents_refused(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory)/"source";root.mkdir()
            m.prepare_patch_parents(root,{m.ACCEPTANCE+"run.ts":b"public"})
            self.assertTrue((root/m.ACCEPTANCE).is_dir())
            (root/"outside").symlink_to(Path(directory),target_is_directory=True)
            with self.assertRaises(m.PackageFailure):m.prepare_patch_parents(root,{"outside/escape.ts":b"public"})
            (root/"plain-file").write_bytes(b"public")
            with self.assertRaises(m.PackageFailure):m.prepare_patch_parents(root,{"plain-file/escape.ts":b"public"})

    def test_dependency_input_comparison_forbids_new_dependencies_and_ponder_changes(self):
        baseline={"files":[{"path":"apps/api/package.json","sha256":m.sha(b'{"dependencies":{"pg":"8"}}')},{"path":"apps/yunipals-indexer/src/index.ts","sha256":m.sha(b"same")}]}
        primitive=types.SimpleNamespace(pinned=lambda path,pin:b'{"dependencies":{"pg":"8"}}')
        m.dependency_inputs(Path("/public"),baseline,{"apps/api/package.json":b'{"dependencies":{"pg":"8"},"scripts":{"build":"new"}}'},primitive)
        for patches in [{"apps/api/package.json":b'{"dependencies":{"pg":"9"}}'},{"new/package.json":b'{}'},{"apps/yunipals-indexer/src/index.ts":b"changed"},{"pnpm-lock.yaml":b"new"}]:
            with self.assertRaises(m.PackageFailure):m.dependency_inputs(Path("/public"),baseline,patches,primitive)

    def test_exact_two_new_entries_and_four_paths_preserve_all330dependencies(self):
        before,after,a,b=runtime_pair();result=m.runtime_delta(before,after,a,b)
        self.assertEqual((result["paths"],result["packages"]),(60922,330))
        self.assertEqual(len(result["addedEntries"]),4)

    def test_dependency_bytes_modes_targets_and_extra_bundle_refused(self):
        before,after,a,b=runtime_pair()
        for update in [{"sha256":"c"*64},{"mode":0o755},{"type":"symlink","target":"changed"}]:
            changed=copy.deepcopy(after);next(r for r in changed["entries"]if r["path"].startswith("node_modules/dependency/")).update(update)
            with self.assertRaises(m.PackageFailure):m.runtime_delta(before,changed,a,b)
        changed=copy.deepcopy(after);changed["entries"][-1]["path"]=m.DIST+"unknown.mjs.map"
        with self.assertRaises(m.PackageFailure):m.runtime_delta(before,changed,a,b)

    def test_full_consumer_changes_require_actual_per_bundle_changed_frozen_sources(self):
        before,after,a,b=runtime_pair()
        expected_other=[]
        for basename in ["rpc-budget-proxy","server"]:
            bundle=m.DIST+basename+".mjs";source="apps/yunipals-market-api/src/"+basename+".ts"
            expected_other.append(bundle)
            a["files"].append({"path":source,"bytes":1,"sha256":"a"*64})
            b["files"].append({"path":source,"bytes":1,"sha256":"b"*64})
            next(row for row in before["bundleProof"]["bundles"]if row["path"]==bundle)["sourcePaths"]=[source]
            next(row for row in after["entries"]if row["path"]==bundle)["sha256"]="f"*64
            next(row for row in after["bundleProof"]["bundles"]if row["path"]==bundle).update(sha256="f"*64,sourcePaths=[source])
        result=m.runtime_delta(before,after,a,b)
        self.assertEqual(result["artifactScope"],"full_consumer_artifact")
        self.assertEqual(result["otherQualifiedChangedConsumerBundles"],expected_other)
        self.assertEqual(set(result["arenaQualifiedChangedBundles"]),m.NEW_BUNDLES)
        self.assertTrue(result["candidateProxyUnselected"])
        self.assertFalse(result["sourceReplayOrProxyActivationApproved"])
        qualifications={row["path"]:row["changedSourcePaths"]for row in result["changedBundleSourceQualifications"]}
        for basename in ["rpc-budget-proxy","server"]:
            self.assertEqual(qualifications[m.DIST+basename+".mjs"],["apps/yunipals-market-api/src/"+basename+".ts"])

    def test_unjustified_consumer_changes_refused_despite_build_config_and_other_arena_change(self):
        before,after,a,b=runtime_pair()
        b["files"].append({"path":"apps/yunipals-market-api/scripts/build.mjs","bytes":1,"sha256":"f"*64})
        for basename in ["rpc-budget-proxy","server"]:
            bundle=m.DIST+basename+".mjs";source="apps/yunipals-market-api/src/"+basename+".ts"
            a["files"].append({"path":source,"bytes":1,"sha256":"a"*64})
            b["files"].append({"path":source,"bytes":1,"sha256":"a"*64})
            next(row for row in before["bundleProof"]["bundles"]if row["path"]==bundle)["sourcePaths"]=[source]
            changed=copy.deepcopy(after)
            next(row for row in changed["entries"]if row["path"]==bundle)["sha256"]="f"*64
            next(row for row in changed["bundleProof"]["bundles"]if row["path"]==bundle).update(sha256="f"*64,sourcePaths=[source])
            with self.assertRaisesRegex(m.PackageFailure,"changed_bundle_requires_reviewed_source_change"):m.runtime_delta(before,changed,a,b)

    def test_missing_map_unbound_source_duplicated_bundle_or_test_runtime_refused(self):
        before,after,a,b=runtime_pair()
        for mutate in [lambda x:x["entries"].pop(),lambda x:x["bundleProof"].update(allSourceContentsMatch=False),lambda x:x["bundleProof"]["bundles"].append(x["bundleProof"]["bundles"][0]),lambda x:x["bundleProof"]["bundles"][0].update(sourcePaths=["x.test.ts"])]:
            changed=copy.deepcopy(after);mutate(changed)
            with self.assertRaises(m.PackageFailure):m.runtime_delta(before,changed,a,b)
        with self.assertRaises(m.PackageFailure):m.runtime_delta(before,after,a,a)

    def test_test_summary_requires_real79_or21_not_empty_success(self):
        for count in [79,21]:m.assert_test_output(f"ℹ tests {count}\nℹ pass {count}\nℹ fail 0\n".encode(),count)
        for raw in [b"",b"exit0",b"# tests 1\n# pass 1\n# fail 0\n",b"# tests 21\n# pass 20\n# fail 1\n",b"# tests 21\n# tests 0\n# pass 21\n# fail 0\n"]:
            with self.assertRaises(m.PackageFailure):m.assert_test_output(raw,21)

    def test_full_catalog_rules_hash_not_only_count_required(self):
        value={"islands":898,"identityProfiles":4,"rulesHash":m.RULES_HASH,"poolHash":m.POOL_HASH};m.assert_catalog(value)
        self.assertEqual(m.assert_catalog({**value,"poolHash":m.POOL_HASH[2:]})["poolHash"],m.POOL_HASH)
        for key,value in [("islands",897),("identityProfiles",3),("rulesHash","0x"+"b"*64),("poolHash","0x"+"a"*64)]:
            with self.assertRaises(m.PackageFailure):m.assert_catalog({**{"islands":898,"identityProfiles":4,"rulesHash":m.RULES_HASH,"poolHash":m.POOL_HASH},key:value})

    def test_hardened_units_have_no_credentials_no_network_and_only_fresh_work_writable(self):
        for mode in ["review","build"]:
            unit=m.unit_text(mode,{"hiddenVolumeChildren":[str(m.VOLUME/"retained")]})
            for line in ["PrivateNetwork=yes","RestrictAddressFamilies=AF_UNIX","CapabilityBoundingSet=","AmbientCapabilities=","NoNewPrivileges=yes","ProtectSystem=strict","ProtectHome=yes","ReadWritePaths="+str(m.WORK),"MemoryMax=2G","RuntimeMaxSec=35min","Restart=no"]:self.assertIn(line,unit)
            self.assertNotIn("EnvironmentFile=",unit);self.assertNotIn("LoadCredential=",unit)
            self.assertIn("arena-modern-package-v1.py",unit)
        self.assertNotIn("--build",m.unit_text("review",{"hiddenVolumeChildren":[]}))

    def test_execute_retains_terminal_failure_and_refuses_same_attempt_replay(self):
        with tempfile.TemporaryDirectory()as directory:
            work=Path(directory)
            with patch.object(m,"WORK",work):
                build=m.Build({"reviewHash":"a","binding":{}},types.SimpleNamespace(),None,None,None,None,None,None,None)
                build.guard=lambda **_:None
                build.build=lambda:(_ for _ in()).throw(m.PackageFailure("synthetic_refusal"))
                with self.assertRaises(m.PackageFailure):build.execute()
                record=json.loads((work/"attempt-result.json").read_bytes());self.assertFalse(record["automaticRetryAllowed"]);self.assertTrue(record["partialWorkRetained"])
                with self.assertRaises(FileExistsError):build.execute()

    def test_source_verifier_checks_every_manifest_byte_including_public_media(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);name=next(iter(m.PUBLIC_MEDIA));path=root/name;path.parent.mkdir(parents=True);path.write_bytes(b"public")
            rows=[{"path":name,"bytes":6,"sha256":m.sha(b"public")}];manifest={"format":"yunipals-unified-source-release-v1","sourceDigest":m.sha(m.encoded(rows)),"files":rows}
            (root/"RELEASE-MANIFEST.json").write_bytes(m.encoded(manifest));(root/"SHA256SUMS").write_text(rows[0]["sha256"]+"  "+name+"\n")
            self.assertEqual(h.source_check(root,manifest["sourceDigest"]),manifest)
            path.write_bytes(b"tamper")
            with self.assertRaises(RuntimeError):h.source_check(root,manifest["sourceDigest"])

    def test_real903_asset_digest_qualification_refuses_tampered_retained_png(self):
        overlay=Path("/tmp/yunipals-arena-live-compat-build-overlay-20261022.tar.gz")
        external=Path("/tmp/yunipals-arena-live-compat-20261022/docs/unified-indexer/arena-live-compat-build-overlay-manifest-2026-10-22.json")
        if not overlay.is_file()or not external.is_file():self.skipTest("Exact retained public references from the frozen overlay are required.")
        patches=m.overlay_payload(json.loads(external.read_bytes()),overlay.read_bytes())
        with tempfile.TemporaryDirectory()as directory:
            source=Path(directory)/"source";retained=Path(directory)/"retained";source.mkdir();retained.mkdir()
            rows=[];assets=[]
            for token in range(1,899):
                name=m.PUBLICATION+"/images/"+str(token)+".png";authority=m.PUBLICATION+"/metadata/"+str(token)+".json"
                image=b"synthetic-image-"+str(token).encode();digest=m.sha(image)
                path=retained/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(image)
                raw=m.encoded({"properties":{"token_id":str(token),"image_sha256":digest}})
                path=source/authority;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
                rows.append({"path":authority,"bytes":len(raw),"sha256":m.sha(raw)})
                assets.append({"path":name,"sha256":digest,"authority":authority})
            for name in sorted(m.PUBLIC_MEDIA):
                raw=patches[name];path=retained/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
                assets.append({"path":name,"sha256":m.sha(raw),"authority":"public-source"})
            raw=m.encoded({"format":"yunipals-external-runtime-assets-v1","assets":assets})
            (source/"EXTERNAL-RUNTIME-ASSETS.json").write_bytes(raw);rows.append({"path":"EXTERNAL-RUNTIME-ASSETS.json","bytes":len(raw),"sha256":m.sha(raw)})
            manifest={"format":"yunipals-unified-source-release-v1","sourceDigest":m.sha(m.encoded(rows)),"files":rows}
            (source/"RELEASE-MANIFEST.json").write_bytes(m.encoded(manifest));(source/"SHA256SUMS").write_text("".join(row["sha256"]+"  "+row["path"]+"\n"for row in rows))
            proof=m.qualify_retained_assets(source,retained,h,p)
            self.assertEqual((proof["qualifiedAssets"],proof["islandPngs"]),(903,898));self.assertTrue(proof["assetsQualified"])
            self.assertFalse(proof["mediaComplete"]);self.assertFalse(proof["assetsCopiedOrAttached"])
            (retained/m.PUBLICATION/"images/1.png").write_bytes(b"changed")
            with self.assertRaises(RuntimeError):m.qualify_retained_assets(source,retained,h,p)

    def test_separate_asset_qualification_never_claims_attachment_or_media_complete(self):
        tree=ast.parse((HERE/"arena-modern-package-v1.py").read_bytes())
        function=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=="qualify_retained_assets")
        text=ast.unparse(function)
        for field in ["image_sha256","token_id","checked_file_hash","islands != 898","903","assetsCopiedOrAttached","mediaComplete"]:self.assertIn(field,text)
        self.assertNotIn("copyfile",text);self.assertNotIn("write_bytes",text)
        source=(HERE/"arena-modern-package-v1.py").read_text()
        self.assertIn('"assetsQualified": False, "mediaComplete": False',source)
        self.assertIn('"legacyNodeSourceVerifierUsed": False',source)

if __name__=="__main__":unittest.main()
