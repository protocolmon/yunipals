#!/usr/bin/env python3
"""Owned filesystem/phase controls; no host, provider, service or SQL actions."""
import ast
import copy
import importlib.util
import contextlib
import io
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent


def load(name):
    s = importlib.util.spec_from_file_location("test_" + name.replace(".", "_"), HERE / name)
    m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m


m = load("ypal-alchemy-ordinary-runtime-v1.py")
p = load("ypal-alchemy-source-switch-v1.plan.py")
leaf = load("ypal-alchemy-primary-current-v1.py")
business = load("ypal-alchemy-source-switch-v1.py")
cache_fixture = load("ypal-alchemy-restart-cache-v1.test.py")


def source_fixture():
    project = "/fixture/project"
    bindings = {"BindPaths": {"type": "a(ssbt)", "data": [["/cache/" + str(i), project + "/cache/" + str(i), False, 16384] for i in range(3)]},
                "BindReadOnlyPaths": {"type": "a(ssbt)", "data": [["/public/" + name, project + "/" + name, False, 16384]
                    for name in ["ponder.config.ts", "lib/boosters/config.ts", "lib/unified/rpc-preflight.ts"]]},
                "EnvironmentFiles": {"type": "a(sb)", "data": []}}
    return {"source": {"parent": {"argv": ["/node", "--env-file=/one", "--env-file=/two", "--env-file=/three",
              project + "/node_modules/ponder/dist/esm/bin/ponder.js", "start", "--schema", "unified_ypal_20261023_v1"]}},
            "sourceRuntime": {"MemoryMax": "6G", "BindPaths": "old text", "BindReadOnlyPaths": "old text"},
            "sourceBindings": bindings}, types.SimpleNamespace(PROJECT=project, STAGE=Path("/fixture/stage"))


class Fixture:
    def __init__(self, root):
        self.root = Path(root); self.base = self.root / "audit"; self.hold = self.root / "hold"; self.system = self.root / "system"
        for path in [self.base, self.hold, self.system]: path.mkdir(mode=0o700)
        self.stack = [patch.object(m, "BASE", self.base), patch.object(m, "HOLD", self.hold), patch.object(m, "SYSTEM", self.system)]
        for value in self.stack: value.start()
        self.o = m.Owner.__new__(m.Owner); o = self.o
        o.input_sha = "a" * 64; o.config = {"financialReceiptSha256": "b" * 64}; o.p = p; o.leaf = leaf
        o.m = types.SimpleNamespace(protected=p.read, document=lambda path,*args:json.loads(p.read(path)), boot=lambda:"boot", mono=lambda:1000)
        o.original = {}; o.calls = []; o.financial_current = lambda:o.calls.append("finance")
        o.terminal = lambda *args,**kwargs:o.calls.append(("terminal",args[0]))
        o.old = types.SimpleNamespace(ns=types.SimpleNamespace(six=business.six, move_link=business.move_link, wait_read=lambda fn:fn()),
            owner=types.SimpleNamespace(known_source_processes=lambda:[], budget_backends_gone=lambda rows:None))
        o.h = types.SimpleNamespace(proxy_unit=lambda c:"rpc-"+c+".service", proxy_drop=lambda c:self.system/("rpc-"+c+".service.d")/m.DROP.name)
        self.op = o.envelope(financialReceiptSha256=o.config["financialReceiptSha256"], overlays={}, publicFiles={}, native={}, originalFreeRoutes={})

    def save_op(self): self.o.put("operation.json", self.op)
    def close(self):
        for value in reversed(self.stack): value.stop()


class Controls(unittest.TestCase):
    def test_domains_use_exact_real_frozen_sources_and_no_effect_default(self):
        for name, pin in m.PINS.items(): self.assertEqual(m.sha((HERE/name).read_bytes()), pin)
        self.assertNotEqual(m.BASE, business.BASE)
        self.assertNotIn("transaction(", Path(m.__file__).read_text())

    def test_source_drop_adds_all_RW_after_systemd_RO_reset_and_fourth_Node_file(self):
        original, plan = source_fixture(); raw=m.source_bytes(original,plan).decode();lines=raw.splitlines()
        self.assertLess(lines.index("BindReadOnlyPaths="),next(i for i,line in enumerate(lines)if line.startswith("BindPaths=")))
        self.assertEqual(sum(line.startswith("BindPaths=")for line in lines),1)
        self.assertIn("/cache/0:/fixture/project/cache/0",raw)
        self.assertIn("ypal-rpc-deadline-host-build-v1/rpc-preflight.ts:/fixture/project/lib/unified/rpc-preflight.ts",raw)
        command=next(line for line in lines if line.startswith("ExecStart=/"))
        self.assertEqual(command.count("--env-file="),4);self.assertIn("source.ordinary.public.env",command)
        self.assertNotIn("EnvironmentFile=",raw)

    def test_source_drop_refuses_missing_RW_or_unsafe_arguments(self):
        for change in [lambda o:o["sourceBindings"]["BindPaths"]["data"].clear(),
                       lambda o:o["source"]["parent"]["argv"].append("$(foreign)")]:
            original, plan=source_fixture();change(original)
            with self.assertRaises(RuntimeError):m.source_bytes(original,plan)

    def test_host_namespace_changes_only_declared_source_env_proxy_and_mount_predicate(self):
        raw=(HERE/"ypal-alchemy-source-switch-v1.host.py").read_bytes()
        ns=m.host_namespace(raw,Path("/fixture/ordinary.py"),lambda *args:True)
        old=load("ypal-alchemy-source-switch-v1.host.py")
        for name in ["kernel_backends","encoded"]:self.assertEqual(getattr(ns,name).__code__.co_code,getattr(old,name).__code__.co_code)
        self.assertEqual(ns.SOURCE_DROP,m.DROP);self.assertEqual(ns.PROXY_DROP_NAME,m.DROP.name)
        for name in ["source_sessions","proxy_sessions"]:self.assertEqual(getattr(ns.Host,name).__code__.co_code,getattr(old.Host,name).__code__.co_code)
        with self.assertRaisesRegex(RuntimeError,"three_explicit"):
            m.host_namespace(raw.replace(b'"source.public.env"',b'"unexpected.env"'),Path("/fixture/ordinary.py"),lambda *args:True)

    def test_actual80_cache_algorithm_accepts_real_ordinary_domain_not_catchup_relabel(self):
        path=HERE/"ypal-alchemy-restart-cache-v1.py";new=m.cache_namespace(path.read_bytes(),path)
        native,capture,plan=cache_fixture.fixture();plan["format"]="yunipals-ypal-alchemy-ordinary-plan-v1"
        value=new.validate_capture(capture,plan,native)
        self.assertTrue(value["cacheCoverageQualified"]);self.assertEqual(value["logFilterRows"],80)
        self.assertEqual(value["planSha256"],new.digest(plan));self.assertEqual(value["format"],m.FORMAT+"-cache")
        self.assertFalse(value["financialAuthorityQualified"])
        row=new.filters()[0];capture["matrix"][row["key"]]=[[str(row["fromBlock"]),str(row["fromBlock"]+1),True,True]]
        with self.assertRaisesRegex(RuntimeError,"older_cache_hole"):new.validate_capture(capture,plan,native)

    def test_actual_typed_zero_RW_and_changed_hardening_refused(self):
        o=m.Owner.__new__(m.Owner);original,_=source_fixture();actual=copy.deepcopy(original["sourceBindings"])
        for row in actual["BindReadOnlyPaths"]["data"]:
            if row[1].endswith("/lib/unified/rpc-preflight.ts"):row[0]=str(m.OPS/"ypal-rpc-deadline-host-build-v1/rpc-preflight.ts")
        o.c=types.SimpleNamespace(source_bindings=lambda:copy.deepcopy(actual))
        properties={"MemoryMax":"6G","BindPaths":"different presentation","BindReadOnlyPaths":"different presentation"}
        h=types.SimpleNamespace(source=types.SimpleNamespace(runtime_properties=lambda:properties))
        self.assertTrue(o.loaded_runtime(h,original,"paid"));actual["BindPaths"]["data"].clear()
        with self.assertRaisesRegex(RuntimeError,"three_RW_three_RO"):o.loaded_runtime(h,original,"paid")
        actual=copy.deepcopy(original["sourceBindings"]);properties["MemoryMax"]="8G"
        with self.assertRaisesRegex(RuntimeError,"nonmount"):o.loaded_runtime(h,original,"free")

    def test_real_owned_move_keeps_inode_refuses_racing_foreign_and_reconciles_prefix(self):
        with tempfile.TemporaryDirectory(dir=HERE)as tmp:
            f=Fixture(tmp)
            try:
                f.save_op();src=f.hold/"owned.conf";target=f.system/"owned.conf"
                item=p.exclusive(src,b"owned",0o644);six={"sha256":item["sha256"],"identity":business.six(item["identity"])}
                target.write_bytes(b"foreign")
                with self.assertRaisesRegex(RuntimeError,"absent_destination"):f.o.move("one",src,target,six)
                self.assertEqual(src.read_bytes(),b"owned");target.unlink();inode=src.stat().st_ino
                f.o.move("one",src,target,six);f.o.move("one",src,target,six)
                self.assertEqual(target.stat().st_ino,inode);self.assertFalse(src.exists())
            finally:f.close()

    def retirement_fixture(self,f):
        files={};links={};units=[];states={}
        for i in range(6):
            for suffix in ["service","timer"]:
                name="old-"+str(i)+"."+suffix;path=f.system/name;item=p.exclusive(path,name.encode(),0o644)
                files[str(path)]={"sha256":item["sha256"],"identity":business.six(item["identity"])}
                units.append(name);states[name]="active"if suffix=="timer"else"inactive"
                if suffix=="timer":
                    boot=f.system/"timers.target.wants"/name;boot.parent.mkdir(exist_ok=True);boot.symlink_to(path)
                    links[str(boot)]=leaf.link_record(boot)
        for i in range(2):
            folder=f.system/("old-"+str(i)+".service.d");folder.mkdir();path=folder/"completion.conf";item=p.exclusive(path,b"completion",0o644)
            files[str(path)]={"sha256":item["sha256"],"identity":business.six(item["identity"])}
        old=f.system/"old-source99.conf";item=p.exclusive(old,b"old source",0o644)
        f.o.original={"sourceOverlay":{"sha256":item["sha256"],"identity":business.six(item["identity"])}}
        f.o.old.ns.SOURCE_DROP=old;f.op["retirement"]={"files":files,"links":links,"units":units};f.save_op()
        def terminal(unit):
            m.need(states[unit]=="inactive","old_deadline_unit_must_be_terminal")
        def manager(verb,unit=None):
            f.o.calls.append((verb,unit))
            if verb=="stop":states[unit]="inactive"
        f.o.unit_terminal=terminal;f.o.manager=manager
        return files,links,states

    def test_actual_retirement_moves14_definitions6boots_old99_and_repeat_sends_no_stops(self):
        with tempfile.TemporaryDirectory(dir=HERE)as tmp:
            f=Fixture(tmp)
            try:
                files,links,_=self.retirement_fixture(f);inodes={p:Path(p).lstat().st_ino for p in [*files,*links]}
                value=f.o.retire();self.assertTrue(value["retired"])
                self.assertEqual(len([x for x in f.o.calls if isinstance(x,tuple)and x[0]=="stop"]),6)
                self.assertTrue(all(not Path(path).exists()for path in files));self.assertTrue(all(not Path(path).is_symlink()for path in links))
                saved_calls=list(f.o.calls);f.o.retire()
                self.assertEqual([x for x in saved_calls if isinstance(x,tuple)and x[0]in{"stop","daemon-reload"}],
                                 [x for x in f.o.calls if isinstance(x,tuple)and x[0]in{"stop","daemon-reload"}])
                self.assertEqual(len(set(inodes.values())),20)
            finally:f.close()

    def test_unknown_timer_stop_does_not_resend_and_keeps_original_definitions(self):
        with tempfile.TemporaryDirectory(dir=HERE)as tmp:
            f=Fixture(tmp)
            try:
                files,_,_=self.retirement_fixture(f);f.o.put("old-0.timer-stop-intent.json",f.o.record(unit="old-0.timer"))
                with self.assertRaisesRegex(RuntimeError,"terminal"):f.o.retire()
                self.assertFalse(any(isinstance(x,tuple)and x[0]=="stop"for x in f.o.calls))
                self.assertTrue(all(Path(path).exists()for path in files))
            finally:f.close()

    def test_unknown_reload_needs_explicit_configuration_completion_no_automatic_resend(self):
        with tempfile.TemporaryDirectory(dir=HERE)as tmp:
            f=Fixture(tmp)
            try:
                self.retirement_fixture(f);calls=[]
                def fail(*args):calls.append(args);raise RuntimeError("lost ack")
                f.o.manager=fail
                with self.assertRaisesRegex(RuntimeError,"lost ack"):f.o.reload("retired")
                with self.assertRaisesRegex(RuntimeError,"explicit_configuration"):f.o.reload("retired")
                self.assertEqual(len(calls),1);f.o.manager=lambda *a:calls.append(a)
                f.o.reload("retired",True);self.assertEqual(len(calls),2)
            finally:f.close()

    def test_lost_proxy_start_ACK_observes_existing_epoch_without_new_manager_effect(self):
        with tempfile.TemporaryDirectory(dir=HERE)as tmp:
            f=Fixture(tmp)
            try:
                f.op["originalFreeRoutes"]={"bnb":{"actor":{"processes":[]}}};f.save_op()
                f.o.put("bnb-start-intent.json",f.o.record(notBeforeUs=1000));f.o.retired_current=lambda:None
                actor={"invocation":"owned","processes":[{"pid":4,"startTicks":5}]}
                f.o.proxy_actor=lambda *args:actor;f.o.h.proxy_sessions=lambda *args:[{"pid":10,"backendStart":"epoch","transport":"unix"}]
                f.o.manager=lambda *args:(_ for _ in()).throw(AssertionError("must not start again"))
                value=f.o.switch_proxy("bnb");self.assertTrue(value["acknowledged"])
                self.assertEqual(f.o.journal("bnb-started.json")["actor"],actor)
            finally:f.close()

    def test_cleanup_repeated_already_free_epochs_never_stops_them_again(self):
        with tempfile.TemporaryDirectory(dir=HERE)as tmp:
            f=Fixture(tmp)
            try:
                f.op["originalFreeRoutes"]={c:{"actor":{"invocation":c}}for c in m.CHAINS};f.save_op();f.o.stop_source=lambda:None
                f.o.old.h=types.SimpleNamespace(free_route=lambda c:copy.deepcopy(f.op["originalFreeRoutes"][c]))
                f.o.leaf=types.SimpleNamespace(assert_no_paid_proxy_processes=lambda:None)
                f.o.quiet_current=lambda:None;f.o.manager=lambda *args:(_ for _ in()).throw(AssertionError("no free stop/start"))
                first=f.o.return_free();second=f.o.return_free();self.assertEqual(first,second)
            finally:f.close()

    def test_lost_free_start_ACK_reconciles_actual_epoch_without_stop_or_start(self):
        with tempfile.TemporaryDirectory(dir=HERE)as tmp:
            f=Fixture(tmp)
            try:
                f.op["originalFreeRoutes"]={c:{"actor":{"invocation":"old-"+c},"definitions":{"same":True}}for c in m.CHAINS};f.save_op()
                for c in m.CHAINS:
                    if c!="bnb":f.o.put(c+"-free-started.json",f.o.record(actor=f.op["originalFreeRoutes"][c]["actor"],retainedOriginal=True))
                actual=copy.deepcopy(f.op["originalFreeRoutes"]["bnb"]);actual["actor"]={"invocation":"new-bnb","startMonotonicMicroseconds":1100}
                f.o.put("bnb-free-start-intent.json",f.o.record(notBeforeUs=1000))
                f.o.put("bnb-stop-paid-intent.json",f.o.record(actor={"processes":[{"pid":20,"startTicks":30}]},ownedBackends=[{"pid":4,"backendStart":"epoch","transport":"unix"}]))
                f.o.old.h=types.SimpleNamespace(free_route=lambda c:actual if c=="bnb"else copy.deepcopy(f.op["originalFreeRoutes"][c]))
                f.o.old.ns.gone=lambda rows:f.o.calls.append(("gone",rows));f.o.h.a=types.SimpleNamespace(state=lambda *a:{"NRestarts":"0"});f.o.h.rpc_m=None
                f.o.stop_source=lambda:None;f.o.leaf=types.SimpleNamespace(assert_no_paid_proxy_processes=lambda:None);f.o.quiet_current=lambda:None
                f.o.manager=lambda *args:(_ for _ in()).throw(AssertionError("lost free ACK is observation only"))
                self.assertTrue(f.o.return_free()["paidRequestsQuiet"])
                self.assertEqual(f.o.journal("bnb-free-started.json")["actor"],actual["actor"])
                self.assertIn(("gone",[{"pid":20,"startTicks":30}]),f.o.calls)
            finally:f.close()

    def test_paid_start_final_CAS_refuses_late_source_after_financial_read(self):
        with tempfile.TemporaryDirectory(dir=HERE)as tmp:
            f=Fixture(tmp)
            try:
                f.save_op();f.o.retired_current=lambda:None;f.o.publish=lambda *a:None;f.o.reload=lambda *a:None
                f.o.proxy_actor=lambda c:{"actor":c}
                for c in m.CHAINS:f.o.put(c+"-started.json",f.o.record(actor={"actor":c}))
                native={"clock":100,"app":{"heartbeat_at":50}};f.o.plan={};f.o.static=lambda:native;f.o.peers=lambda:{"same":True};f.o.loaded_source=lambda mode:True
                f.o.cache=types.SimpleNamespace(validate_restart_capture=lambda *args:{"cacheCoverageQualified":True})
                f.o.h.source=types.SimpleNamespace(query=lambda *a:None);f.o.known_source=lambda:[]
                state={"appeared":False,"financialReads":0}
                def finance():
                    state["financialReads"]+=1
                    if state["financialReads"]==2:state["appeared"]=True
                def terminal(*args):m.need(not state["appeared"],"late_foreign_source")
                f.o.financial_current=finance;f.o.terminal=terminal
                f.o.manager=lambda *a:(_ for _ in()).throw(AssertionError("must not start over late actor"))
                with self.assertRaisesRegex(RuntimeError,"late_foreign_source"):f.o.start_source()
                self.assertTrue(f.o.has("source-paid-start-intent.json"));self.assertFalse(f.o.has("result.json"))
            finally:f.close()

    def test_health_independent_owned_stop_records_source_DB_pending_honestly(self):
        with tempfile.TemporaryDirectory(dir=HERE)as tmp:
            f=Fixture(tmp)
            try:
                f.save_op();actor={"processes":[{"pid":10,"startTicks":20}]};f.o.source_actor=lambda *a,**kw:(actor,None)
                f.o.h.source=types.SimpleNamespace(state=lambda *args:{"MainPID":"10"})
                f.o.h.source_sessions=lambda *args:(_ for _ in()).throw(RuntimeError("database unavailable"))
                f.o.old.owner.process_terminal=lambda *args:f.o.calls.append(("terminal",args))
                f.o.manager=lambda *args:f.o.calls.append(args);f.o.known_source=lambda:[]
                value=f.o.stop_source();self.assertTrue(value["sourceStopped"]);self.assertFalse(value["sourceDrainedQualified"])
                self.assertEqual(sum(x==("stop",m.SOURCE)for x in f.o.calls),1)
                self.assertFalse(f.o.journal("source-stopped.json")["sourceDrainedQualified"])
            finally:f.close()

    def test_disabled_current_uses_actual_ACK_monotonic_counters_and_immutable_input(self):
        o=m.Owner.__new__(m.Owner);o.m=types.SimpleNamespace(pin=lambda x:x=="a"*64);o.plan={"actualPermits":"same"}
        calls=[];ack={"reviewSha256":"review","after":{"booked":11},"committed":True};current={"booked":12}
        o.fo=types.SimpleNamespace(digest=lambda name:"a"*64,receipt=lambda name:ack,reviewed=lambda pin:{"before":{"booked":2},"proposal":o.plan},
            disabled=lambda *a:calls.append("disabled"),m=object(),h=types.SimpleNamespace(snapshot=lambda:current,immutable=lambda:calls.append("immutable")))
        def monotonic(model,before,after):
            calls.append("monotonic");m.need(after["booked"]>=before["booked"],"counter_refund")
        o.financial=types.SimpleNamespace(monotonic=monotonic)
        o.disabled_current("a"*64);self.assertEqual(calls,["disabled","monotonic","immutable"])
        current["booked"]=10
        with self.assertRaisesRegex(RuntimeError,"counter_refund"):o.disabled_current("a"*64)

    def lost_source(self, mode):
        with tempfile.TemporaryDirectory(dir=HERE)as tmp:
            f=Fixture(tmp)
            try:
                f.save_op();f.o.m.pin=p.pin;disabled=None if mode=="paid"else"c"*64;native={"clock":200,"app":{"heartbeat_at":180}}
                peers={"private":"same"};actor={"parent":{"pid":10},"processes":[{"pid":10,"startTicks":20}],"unit":{"InvocationID":"new"}}
                f.o.put("source-"+mode+"-start-intent.json",f.o.record(notBeforeUs=1000,preStartDatabaseClock=100,
                    predecessorHeartbeat=50,peers=peers,disabledReceiptSha256=disabled))
                f.o.retired_current=lambda:f.o.calls.append("retired");f.o.static=lambda:native;f.o.loaded_source=lambda selected:f.o.calls.append(("loaded",selected))
                f.o.source_actor=lambda *args,**kw:(actor,native);f.o.peers=lambda:peers
                f.o.h.source_sessions=lambda current:{m.SOURCE:[{"pid":40,"backendStart":"epoch","transport":"unix"}]}
                f.o.c=types.SimpleNamespace(current_pack_ready=lambda:f.o.calls.append("packHTTP"))
                f.o.disabled_current=lambda value:f.o.calls.append(("disabled",value));f.o.free_routes_current=lambda:f.o.calls.append("four-free")
                f.o.leaf=types.SimpleNamespace(assert_no_paid_proxy_processes=lambda:f.o.calls.append("no-paid-proxies"))
                f.o.proxy_actor=lambda chain:{"invocation":chain}
                for chain in m.CHAINS:f.o.put(chain+"-started.json",f.o.record(actor={"invocation":chain}))
                def forbidden(*args,**kwargs):raise AssertionError("existing source intent is observation only")
                f.o.manager=f.o.publish=f.o.reload=f.o.terminal=f.o.quiet_current=forbidden
                first=f.o.start_source(mode,disabled);self.assertTrue(first["acknowledged"])
                target="result.json"if mode=="paid"else"free-result.json"
                self.assertEqual(f.o.journal(target)["source"],actor)
                before=(f.base/target).read_bytes();native["clock"]=201
                self.assertEqual(f.o.start_source(mode,disabled),first);self.assertEqual((f.base/target).read_bytes(),before)
                if mode=="paid":self.assertIn("finance",f.o.calls)
                else:self.assertIn("four-free",f.o.calls);self.assertIn(("disabled",disabled),f.o.calls)
                if mode=="free":
                    with self.assertRaisesRegex(RuntimeError,"same_financial_or_disabled"):f.o.start_source(mode,"d"*64)
            finally:f.close()

    def test_actual_lost_paid_source_start_ACK_completes_without_any_manager_effect(self):self.lost_source("paid")
    def test_actual_lost_free_source_start_ACK_completes_without_terminal_or_quiet_effect(self):self.lost_source("free")

    def test_actual_current_CLI_exports_only_hashes_counts_flags_not_private_actor(self):
        private="DO_NOT_EXPORT_PRIVATE_PATH_OR_CONFIGURATION"
        value={"validated":True,"receiptSha":"a"*64,"bindingSha256":"b"*64,"nativeTables":{"one":private},
            "sourceKernelActors":{"source":{"argv":[private]}},"binding":{"private":private},
            "observation":{"native":{"private":private},"positiveKernelSessions":3},"currentWriterQualified":True}
        fake=types.SimpleNamespace(current=lambda digest:value,old=types.SimpleNamespace(v=types.SimpleNamespace(transition_lock=lambda _:contextlib.nullcontext())),m=object())
        with patch.object(m,"Owner",return_value=fake),patch.object(m.os,"geteuid",return_value=0),patch.object(m.os,"getegid",return_value=0),\
             patch.object(m.socket,"gethostname",return_value="yunipals-main"),patch.object(m.signal,"signal"),patch.object(m.signal,"alarm"),\
             patch("sys.argv",[str(HERE/m.__file__),"--input-sha","c"*64,"--current","a"*64]),patch("sys.stdout",new_callable=io.StringIO)as out:
            m.main()
        raw=out.getvalue();self.assertNotIn(private,raw);result=json.loads(raw)
        self.assertEqual(result["nativeTableCount"],1);self.assertEqual(result["positiveKernelSessions"],3);self.assertTrue(result["validated"])
        self.assertNotIn("binding",result);self.assertNotIn("sourceKernelActors",result)


if __name__=="__main__":unittest.main()
