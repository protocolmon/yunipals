#!/usr/bin/env python3
"""Offline real retained-module/FS controls. No service, DB or RPC calls."""
import importlib.util
import json
import os
import shutil
import subprocess
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

FILE = Path(__file__).with_name("ypal-source-start-v1.py")
spec = importlib.util.spec_from_file_location("ypal_source", FILE)
s = importlib.util.module_from_spec(spec); spec.loader.exec_module(s)
core_spec = importlib.util.spec_from_file_location("ypal_core", FILE.with_name("ypal-backend-owner-v1.py"))
m = importlib.util.module_from_spec(core_spec); core_spec.loader.exec_module(m)


class SourceControls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=FILE.parent, prefix=".ypal-source-controls-")
        self.root = Path(self.temp.name).absolute()
        self.base = self.root / "journal"; self.base.mkdir(mode=0o700)
        self.patcher = patch.object(s, "BASE", self.base); self.patcher.start()
        m.save(self.base / "operation.json", {"format": s.FORMAT})

    def tearDown(self): self.patcher.stop(); self.temp.cleanup()

    def test_exact_executed_preparation_wrapper_imports_real_frozen_chain(self):
        with patch.object(s, "PREPARE_FILE", FILE.with_name("ypal-backend-prepare-owner-v3.py").absolute()):
            loaded = s.prepare_module()
        self.assertEqual(loaded.PHASES, ("prepare",))
        self.assertEqual(loaded.__file__, str(FILE.with_name("ypal-backend-prepare-owner-v3.py").absolute()))
        self.assertEqual(loaded.SCHEMA, s.SCHEMA)
        self.assertEqual(loaded.PROFILE_ID, "0x25308afec8bf9d4992afb5dbf52675d958ee1c619533e7917ae3fe08dbd29c86")

    def test_exclusive_durable_intent_blocks_duplicate_after_lost_ack(self):
        called = []
        def effect(_): called.append("attempt"); raise RuntimeError("lost_ack")
        journal = s.Journal(m)
        self.assertRaises(RuntimeError, journal.action, "start-new-source", {}, effect)
        self.assertRaises(RuntimeError, journal.action, "start-new-source", {}, effect)
        self.assertEqual(called, ["attempt"])
        self.assertTrue((self.base / "start-new-source-intent.json").exists())
        self.assertFalse((self.base / "start-new-source-result.json").exists())

    def test_real_ack_binds_actual_intent_and_producer(self):
        s.Journal(m).action("start-new-source", {}, lambda _: {"pid": 10})
        intent = m.load(self.base / "start-new-source-intent.json")
        ack = m.load(self.base / "start-new-source-result.json")
        self.assertEqual(ack["intentSha256"], s.sha(m.protected(self.base / "start-new-source-intent.json")))
        self.assertEqual(intent["operatorSha256"], s.sha(FILE.read_bytes()))
        owner = s.SourceStart(types.SimpleNamespace(m=m))
        self.assertEqual(owner.action_record("start-new-source")[1], {"pid": 10})
        (self.base / "start-new-source-intent.json").write_bytes(s.encoded({**intent, "binding": {"foreign": True}}))
        self.assertRaises(RuntimeError, owner.action_record, "start-new-source")

    def test_boot_inverse_refuses_foreign_same_target_inode(self):
        target = str(self.root / "unit"); link = self.root / "boot"
        os.symlink(target, link); record = s.link_record(m, link, target)
        link.rename(self.root / "old-link"); os.symlink(target, link)
        self.assertRaises(RuntimeError, s.unlink_owned, m, link, record)
        self.assertTrue(link.is_symlink())

    def test_owned_boot_inverse_removes_only_recorded_link(self):
        link = self.root / "boot"; target = str(self.root / "unit")
        os.symlink(target, link); record = s.link_record(m, link, target)
        s.unlink_owned(m, link, record); self.assertFalse(os.path.lexists(link))

    def test_loaded_foreign_file_same_bytes_refused_by_reused_inode_guard(self):
        file = self.root / "unit"; pin = m.write_new(file, b"public definition", 0o644)
        file.rename(self.root / "original"); m.write_new(file, b"public definition", 0o644)
        self.assertRaises(RuntimeError, m.owned_file, file, pin)

    def test_stop_race_refuses_foreign_replacement_without_manager_command(self):
        old = {"pid": 10, "invocation": "a"}; foreign = {"pid": 11, "invocation": "b"}
        oldlink = self.root / "old-boot"; os.symlink("/fixed/unit", oldlink)
        binding = {"oldActor": old, "oldBootLink": s.link_record(m, oldlink, "/fixed/unit")}
        actors = iter([old, foreign])
        host = types.SimpleNamespace(m=m, old_actor=lambda: next(actors), attribute=lambda _: {"complete": True, "applicationNameOrAgeInference": False, "sharedRoleZeroSessionsRequired": False, "oldBackends": []}, unchanged=lambda _: None, unit=lambda _: {})
        owner = s.SourceStart(host)
        with patch.object(s, "OLD_BOOT", oldlink), patch.object(s, "manager") as manager:
            self.assertRaisesRegex(RuntimeError, "foreign_replacement", owner.stop_old, binding)
            manager.assert_not_called()
        self.assertTrue((self.base / "stop-old-source-intent.json").exists())

    def test_fresh_source_waits_for_late_direct_esbuild_before_start_ack(self):
        actor = {"pid": 1, "actorPids": [1]}
        observer = types.SimpleNamespace(actor=lambda *_: actor)
        host = object.__new__(s.Host); host.unit=lambda _: {}; host.h=types.SimpleNamespace(observer=observer, core=object())
        self.assertRaisesRegex(RuntimeError, "wait_for_exact_Node_and_esbuild", host.fresh_actor, {})

    def test_fixed_manager_never_targets_api_or_shared_BNB(self):
        for action, unit in (("start", m.API), ("stop", s.COMBINED), ("restart", s.SOURCE), ("disable", m.TIMER)):
            with patch.object(s.subprocess, "run") as run:
                self.assertRaises(RuntimeError, s.manager, action, unit); run.assert_not_called()

    def test_runtime_owner_never_normalizes_live_source_identity(self):
        a = {"unit": s.SOURCE, "pid": 10, "invocation": "a", "startTicks": 12, "cgroup": "/fixed", "actorPids": [10, 11]}
        b = {**a, "invocation": "replacement"}
        self.assertNotEqual(s.actor_identity(a), s.actor_identity(b))

    def test_socket_mapper_accepts_combined_pool_churn_but_not_unowned_connection(self):
        observer = m.pinned_module(FILE.with_name("ypal-old-runtime-inventory-v1.py").absolute(), m.OBSERVER_SHA)
        rows = [{"pid": 100, "backendStart": "a", "clientAddress": None, "clientPort": -1}, {"pid": 101, "backendStart": "new-pool-member", "clientAddress": None, "clientPort": -1}]
        clients = {"1": {"startTicks": 7, "socketInodes": [10, 11]}}
        backend = {"100": {"startTicks": 8, "socketInodes": [20]}, "101": {"startTicks": 9, "socketInodes": [21]}}
        mapped = observer.map_owned_backends(clients, backend, rows, {10: 20, 20: 10, 11: 21, 21: 11}, {})
        self.assertEqual({r["pid"] for r in mapped}, {100, 101})
        mapped = observer.map_owned_backends(clients, backend, rows, {10: 20, 20: 10}, {})
        self.assertNotEqual({r["pid"] for r in mapped}, {r["pid"] for r in rows})

    def test_real_source_candidate_preserves_only_three_writable_mounts_and_pool5(self):
        fixture_spec=importlib.util.spec_from_file_location("inactive_fixtures", FILE.with_name("ypal-backend-owner-v1-test.py"))
        fixture=importlib.util.module_from_spec(fixture_spec);fixture_spec.loader.exec_module(fixture)
        definition, argv=fixture.old_definition(); candidate=m.source_candidates(definition, argv, fixture.DEPLOYMENT, fixture.proposal())
        self.assertIn(b"BindReadOnlyPaths=", candidate["definition"])
        self.assertEqual(candidate["definition"].count(b"BindPaths="), 1)
        self.assertIn("poolConfig:{max:5}", m.source_config(fixture.DEPLOYMENT, fixture.proposal()).decode())
        self.assertIn("--schema", candidate["argv"])
        self.assertEqual(candidate["argv"][candidate["argv"].index("--schema")+1], s.SCHEMA)

    def test_lost_start_reconciliation_never_invokes_manager_or_claims_original_ack(self):
        m.save(self.base / "start-new-source-intent.json", {"format": s.FORMAT, "operationSha256": s.sha(m.protected(self.base/"operation.json")), "operatorSha256": s.self_sha(m), "bootId": m.boot(), "monotonicNs": 1})
        actor={"pid":10, "invocation":"owned"}
        host=types.SimpleNamespace(m=m, fresh_actor=lambda *_: actor)
        owner=s.SourceStart(host);owner.load=lambda _: {};owner.old_terminal=lambda _: {}
        with patch.object(s, "manager") as manager:
            value=owner.reconcile_start(s.sha(m.protected(self.base/"operation.json"))); manager.assert_not_called()
        self.assertFalse(value["originalStartAcknowledged"])
        self.assertEqual(owner.owned_start()[1], actor)
        self.assertRaises(RuntimeError, owner.reconcile_start, s.sha(m.protected(self.base/"operation.json")))

    def test_actual_preflight_module_resolves_only_retained_sibling_viem_offline(self):
        # Reproduce source008's app-only node_modules layout outside the repo,
        # then run the actual preflight function with a fully blocked fake fetch.
        repo=FILE.resolve().parents[2]
        node=Path("/root/.nvm/versions/node/v24.18.1/bin/node")
        with tempfile.TemporaryDirectory(prefix="ypal-preflight-module-") as directory:
            root=Path(directory); project=root/"apps/yunipals-indexer"; project.mkdir(parents=True)
            (root/"package.json").write_text('{"type":"module"}\n')
            shutil.copytree(repo/"apps/yunipals-indexer/lib",project/"lib")
            for name in ("yunipals-market-core","yunipals-indexer-client","yunipals-indexer-server"):
                shutil.copytree(repo/"packages"/name/"src",root/"packages"/name/"src")
            modules=project/"node_modules";modules.mkdir()
            for name in ("viem","tsx"):
                os.symlink((repo/"apps/yunipals-indexer/node_modules"/name).resolve(),modules/name)
            (root/"profile.json").write_bytes(FILE.with_name("ypal-rpc-profile-v1.json").read_bytes())
            (root/"launch.public.env").write_text("UNIFIED_RPC_POLICY_REQUIRED=true\nUNIFIED_RPC_FREE_ONLY=true\nUNIFIED_RPC_PROFILE_ID="+m.PROFILE_ID+"\nUNIFIED_RPC_PROFILE_FILE="+str(root/"profile.json")+"\nPONDER_RPC_URL_8453=http://127.0.0.1:19212/unified\n")
            loader=str(modules/"tsx/dist/loader.mjs")
            baseline=subprocess.run([str(node),"--import",loader,"--input-type=module","-e","await import('../../packages/yunipals-market-core/src/seaportEvents.ts')"],cwd=project,capture_output=True)
            self.assertNotEqual(baseline.returncode,0)
            self.assertIn(b"Cannot find package 'viem'",baseline.stderr)
            host=object.__new__(s.Host)
            host.m=types.SimpleNamespace(NODE=str(node),PROJECT=project,OLD_ROOT=root,ROOT=root,protected=m.protected,file_identity=m.file_identity)
            policy={"endpoint":"http://127.0.0.1:19212/unified","profileId":m.PROFILE_ID}
            prefix="const __calls=[];globalThis.fetch=async(url,options)=>{const u=String(url),h=options.headers;if(h['x-yunipals-unified-rpc-profile']!==process.env.UNIFIED_RPC_PROFILE_ID)throw Error('headers');__calls.push([u,h['x-yunipals-rpc-workload']]);if(u.endsWith('/unified/preflight'))return new Response(JSON.stringify({profileId:process.env.UNIFIED_RPC_PROFILE_ID,manifestHash:'0x83262c45a53f94ed561c6116fc9efeccf69bd55839e7296f7f5276bc7c89e9ac',chainId:8453,coordinatorId:'faf1bb8c-4306-4c43-b55e-6ac5fa038567',scope:'yunipals-opensea',workload:h['x-yunipals-rpc-workload'],paid:'explicit_bounded_permit_only',budget:{},replay:{mode:'free_only'}}));if(u!=='http://127.0.0.1:19212/unified'||JSON.parse(options.body).method!=='eth_chainId')throw Error('network_forbidden');return new Response(JSON.stringify({result:'0x2105'}));};"
            real_run=subprocess.run
            def run(args,**kwargs):
                argv=list(args);argv[-1]=prefix+argv[-1]+"if(__calls.length!==3)throw Error('exact_three_reads');"
                return real_run(argv,**kwargs)
            with patch.object(s.subprocess,"run",side_effect=run), patch.object(s,"VIEM_ENTRY",(repo/"apps/yunipals-indexer/node_modules/viem/_esm/index.js").resolve()):
                proof=host.preflight(policy)
            self.assertTrue(proof["passed"])
            self.assertFalse(proof["allChainDefaultPreflight"])

    def test_wholeblock_and_type_rules_not_only_phase_flags(self):
        # Calls the actual native SQL/concrete validation with a synthetic JSON
        # row; the same verbatim query is independently EXPLAINed on actual PG.
        deployment={"registry":"0x"+"1"*40,"engine":"0x"+"2"*40,"monsters":"0x"+"3"*40,"ypal":"0x"+"4"*40,"catalogHash":"0x"+"5"*64,"sourceStartBlock":"100"}
        point="1792786600"+str(8453).zfill(16)+str(200).zfill(16)+"9"*33
        typ={"id":"8453:"+deployment["registry"]+":1","registry":deployment["registry"],"engine":deployment["engine"],"payment_token":deployment["ypal"],"pack_type_id":"1","price":"1000000000000000000","interval_seconds":86400,"mints_per_interval":1,"total_variants":264,"max_batch":7,"catalog_hash":deployment["catalogHash"],"rule_hash":"0x"+"6"*64,"sales_paused":False,"manifest_uri":"https://api.yunipals.com/yunipals-indexer/v1/boosters/art/base-mainnet-standard-v1/manifest.json","metadata_base_uri":"https://api.yunipals.com/yunipals-indexer/v1/boosters/art/base-mainnet-standard-v1/"}
        row={"schemaOid":"99","owner":"73004621","app":{"build_id":"8e88ea2e00","version":6,"is_dev":0,"is_locked":1,"is_ready":1,"heartbeat_at":"1792786600000"},"checkpoint":point,"clock":1792786600000,"types":[typ],"tables":[{"name":n,"oid":str(i+1),"owner":"73004621","kind":"r"} for i,n in enumerate(m.TABLES)],"eventTail":["0",None],"badAddresses":False}
        host=object.__new__(s.Host);host.m=m;host.h=types.SimpleNamespace(query=lambda _:row);host.rpc_header=lambda *_:{"hash":"0x"+"a"*64,"timestamp":1792786600}
        binding={"deployment":deployment,"buildId":"8e88ea2e00","expectedRuleHash":typ["rule_hash"],"policy":{}}
        self.assertEqual(host.native(binding)["schemaOid"],"99")
        row["checkpoint"]=point[:-1]+"8"
        self.assertRaisesRegex(RuntimeError,"whole_native",host.native,binding)
        row["checkpoint"]=point;typ["payment_token"]="0x"+"0"*40
        self.assertRaisesRegex(RuntimeError,"actual_native_YPAL",host.native,binding)


if __name__ == "__main__": unittest.main()
