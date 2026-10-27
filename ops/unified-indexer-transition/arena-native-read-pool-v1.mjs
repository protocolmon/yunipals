// Root-delegated local native read sessions share the projector's one PG pool.
import { createServer, Socket } from "node:net";
import { EventEmitter } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import { fstatSync, lstatSync, readFileSync, readlinkSync } from "node:fs";

export const POOL_FORMAT = "yunipals-arena-native-read-pool-v1";
const MAX_LINE = 16 * 1024 * 1024;
const MAX_QUERY = 200000;
const LEASE_MILLISECONDS = 120000;
const need = (ok, code) => { if (!ok) throw Error(code); };
const encode = (value) => {
  if (value instanceof Date) return ["date", value.toISOString()];
  if (Buffer.isBuffer(value)) return ["buffer", value.toString("base64")];
  if (typeof value === "bigint") return ["bigint", String(value)];
  if (typeof value === "undefined") return ["undefined"];
  if (Array.isArray(value)) return ["array", value.map(encode)];
  if (value && typeof value === "object") return ["object", Object.entries(value).map(([key, row]) => [key, encode(row)])];
  return ["value", value];
};
const decode = (value) => {
  need(Array.isArray(value), "typed_native_pool_value_required");
  if (value[0] === "undefined" && value.length === 1) return undefined;
  need(value.length === 2, "exact_typed_native_pool_value_required");
  if (value[0] === "date") return new Date(value[1]);
  if (value[0] === "buffer") return Buffer.from(value[1], "base64");
  if (value[0] === "bigint") return BigInt(value[1]);
  if (value[0] === "array") return value[1].map(decode);
  if (value[0] === "object") return Object.fromEntries(value[1].map(([key, row]) => [key, decode(row)]));
  need(value[0] === "value", "known_native_pool_value_type_required");
  return value[1];
};
const identityHash = (value) => createHash("sha256").update(JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item)).digest("hex");

export function serviceRuntimeEpoch(){
  const stat=readFileSync('/proc/self/stat','utf8'),startTicks=Number(stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]);
  const invocation=process.env.INVOCATION_ID,bootId=readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
  need(Number.isSafeInteger(startTicks)&&startTicks>0&&/^[a-f0-9]{32}$/.test(invocation)&&/^[a-f0-9-]{36}$/.test(bootId),
    'actual_systemd_process_invocation_and_boot_epoch_required');
  return {pid:process.pid,startTicks,invocation,bootId};
}

/** Queue outside pg.Pool's connection-attempt timeout. No second connection is
 * created when a bounded inspection temporarily owns the shared client. */
export function sharedReadPool(raw) {
  need(raw?.options?.max===1,"one_actual_shared_PG_connection_required");
  const events=new EventEmitter(),waiters=[];
  let active=false,closed=false;
  const acquire=()=>new Promise((resolve,reject)=>{
    if(closed){reject(Error('shared_read_pool_closed'));return;}
    if(!active){active=true;resolve();return;}
    if(waiters.length>=9){reject(Error('bounded_shared_read_pool_waiters_required'));return;}
    const entry={resolve,reject,timer:null};entry.timer=setTimeout(()=>{
      const index=waiters.indexOf(entry);if(index>=0)waiters.splice(index,1);reject(Error('bounded_shared_read_pool_wait_required'));
    },LEASE_MILLISECONDS);waiters.push(entry);
  });
  const release=()=>{const entry=waiters.shift();if(entry){clearTimeout(entry.timer);entry.resolve();}else active=false;};
  events.options={...raw.options,max:1};
  events.connect=async()=>{
    await acquire();let client;
    try{client=await raw.connect();}catch(error){release();throw error;}
    let released=false;
    return {query:(...args)=>client.query(...args),release:(error)=>{
      need(!released,'one_shared_read_pool_release_required');released=true;
      try{client.release(error);}finally{release();}
    }};
  };
  events.query=async(...args)=>{const client=await events.connect();try{return await client.query(...args);}finally{client.release();}};
  events.end=async()=>{closed=true;for(const entry of waiters.splice(0)){clearTimeout(entry.timer);entry.reject(Error('shared_read_pool_closed'));}await raw.end();};
  raw.on('error',()=>{});
  events.sharedMaximumConnections=1;
  return events;
}

function lines(socket, receive, fail) {
  let pending = Buffer.alloc(0);
  socket.on("data", (raw) => {
    try {
      pending = Buffer.concat([pending, raw]);
      need(pending.length <= MAX_LINE, "bounded_native_pool_frame_required");
      for (;;) {
        const offset = pending.indexOf(10);
        if (offset < 0) break;
        const row = pending.subarray(0, offset); pending = pending.subarray(offset + 1);
        need(row.length > 0, "one_native_pool_JSON_frame_required");
        receive(JSON.parse(row.toString("utf8")));
      }
    } catch (error) { fail(error); }
  });
}

function send(socket, value) {
  const raw = Buffer.from(JSON.stringify(value) + "\n");
  need(raw.length <= MAX_LINE, "bounded_native_pool_response_required");
  socket.write(raw);
}

function readQuery(value) {
  need(typeof value === "string" && value.length > 0 && value.length <= MAX_QUERY, "bounded_native_read_query_required");
  const text = value.trim();
  need((/^(SELECT|WITH)\b/i.test(text) && !text.includes(';') && !/\b(set_config|pg_advisory_lock|pg_terminate_backend|pg_cancel_backend|lo_import|lo_export)\b/i.test(text)) ||
    /^(BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY|COMMIT|ROLLBACK);?$/i.test(text),
    "native_read_or_exact_snapshot_control_query_required");
  return value;
}

/** The listener must be inherited from the root-owned mode0600 systemd socket.
 * Each connected root-delegated channel owns a single genuine PG PoolClient.
 * A disconnect/timeout always rolls back before releasing that exact client.
 */
export async function serveNativeReadPool(pool, options) {
  need(options && Number.isInteger(options.fd) && options.fd >= 3 && options.identity && options.identity.sourceRole.name === "arena_native_reader",
    "fixed_root_socket_and_native_pool_identity_required");
  need(identityHash(options.identity.runtimeEpoch)===identityHash(serviceRuntimeEpoch()),'actual_self_runtime_epoch_required_for_shared_listener');
  const file=lstatSync(options.path), descriptor=fstatSync(options.fd);
  need(file.isSocket() && file.uid===0 && file.gid===0 && (file.mode&511)===384 && descriptor.isSocket() && descriptor.uid===0 && descriptor.gid===0,
    "actual_root_owned_mode0600_listener_required");
  const link=readlinkSync('/proc/self/fd/'+options.fd), inode=/^socket:\[([1-9][0-9]*)\]$/.exec(link)?.[1];
  const registrations=readFileSync('/proc/net/unix','utf8').trim().split('\n').slice(1).map((line)=>line.trim().split(/\s+/))
    .filter((row)=>row[6]===inode);
  need(registrations.length===1 && registrations[0][3]==='00010000' && registrations[0][4]==='0001' && registrations[0].slice(7).join(' ')===options.path,
    'inherited_listener_must_match_fixed_root_socket_path');
  const sockets = new Set();
  let closing = false;
  const server = createServer((socket) => {
    if (closing || sockets.size >= 8) { socket.destroy(); return; }
    sockets.add(socket);
    let client = null, lease = null, expected = 1, chain = Promise.resolve(), timer = null, dead = false, queued = 0;
    const cleanup = async () => {
      clearTimeout(timer); timer = null;
      const actual = client; client = null; lease = null;
      if (actual) {
        try { await actual.query("ROLLBACK"); await actual.query("DISCARD ALL"); actual.release(); }
        catch (error) { actual.release(error); throw error; }
      }
    };
    const fail = () => { dead = true; socket.destroy(); };
    socket.on("error", fail);
    socket.on("close", () => { dead = true; sockets.delete(socket); chain = chain.then(cleanup, cleanup).catch(() => {}); });
    lines(socket, (message) => {
      if (++queued > 8) { fail(); return; }
      chain = chain.then(async () => {
        if (dead) return;
        try {
          need(message && message.format === POOL_FORMAT && Number.isSafeInteger(message.id) && message.id === expected++ &&
            ["connect", "query", "release"].includes(message.action), "ordered_native_pool_request_required");
          const keys = message.action === "connect" ? ["format", "id", "action", "poolKind", "identitySha256"] : message.action === "release"
            ? ["format", "id", "action", "lease"] : ["format", "id", "action", "lease", "text", "values"];
          need(Object.keys(message).sort().join() === keys.sort().join(), "exact_native_pool_request_shape_required");
          if (message.action === "connect") {
            need(client === null && lease === null, "one_native_pool_session_per_channel_required");
            need(["native","target"].includes(message.poolKind) && (message.poolKind==='native' || options.targetPool),"explicit_actual_shared_read_pool_kind_required");
            need(message.identitySha256===identityHash(options.identity),'same_actual_projector_source_pool_epoch_required');
            client = await (message.poolKind==='native'?pool:options.targetPool).connect();
            if (dead) { await cleanup(); return; }
            const expectedRole=message.poolKind==='native'?options.identity.sourceRole:options.identity.publicReaderRole;
            const expectedDatabase=message.poolKind==='native'?options.identity.nativeDatabaseOid:options.identity.publicDatabaseOid;
            const current=(await client.query("SELECT current_user AS name,session_user AS authenticated_name,(SELECT oid::int FROM pg_roles WHERE rolname=current_user) AS oid,(SELECT oid::int FROM pg_database WHERE datname=current_database()) AS database_oid,current_setting('default_transaction_read_only') AS default_readonly,current_setting('transaction_read_only') AS readonly")).rows[0];
            need(current?.name===expectedRole?.name && current.authenticated_name===expectedRole.name && current.oid===expectedRole.oid && current.database_oid===expectedDatabase &&
              current.default_readonly==='on' && current.readonly==='on',"actual_readonly_shared_pool_role_database_required");
            lease = randomBytes(24).toString("hex");
            timer = setTimeout(fail, LEASE_MILLISECONDS);
            send(socket, { format: POOL_FORMAT, id: message.id, ok: true, lease, poolKind:message.poolKind, identity: options.identity });
          } else {
            need(client && typeof message.lease === "string" && message.lease === lease, "same_native_pool_session_lease_required");
            if (message.action === "release") { await cleanup(); send(socket, { format: POOL_FORMAT, id: message.id, ok: true }); }
            else {
              const values = decode(message.values);
              need(Array.isArray(values), "native_query_parameter_array_required");
              const result = await client.query(readQuery(message.text), values);
              send(socket, { format: POOL_FORMAT, id: message.id, ok: true, result: encode({ rows: result.rows, fields: result.fields,
                rowCount: result.rowCount, command: result.command, oid: result.oid }) });
            }
          }
        } catch (error) {
          if(message.action==='connect' && client && lease===null){
            try{await cleanup();}catch{fail();return;}
          }
          // Preserve a failed transaction on the same session so the genuine
          // caller can issue ROLLBACK. Diagnostic SQL text is never returned.
          if (!dead) send(socket, { format: POOL_FORMAT, id: message.id, ok: false,
            code: typeof error.code === "string" && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : "native_pool_request_refused" });
        }
      }).finally(() => { queued--; }).catch(fail);
    }, fail);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen({ fd: options.fd }, resolve); });
  return { close: async () => { closing = true; for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); } };
}

export function nativeReadPoolClient(fd, expectedIdentity) {
  need(Number.isInteger(fd) && fd >= 3 && expectedIdentity && expectedIdentity.sourceRole.name === "arena_native_reader",
    "actual_root_delegated_native_pool_descriptor_required");
  return nativeReadPoolSession(new Socket({ fd, readable: true, writable: true }), expectedIdentity,'native');
}

export function publicReadPoolClient(fd,expectedIdentity){
  need(Number.isInteger(fd)&&fd>=3,"actual_root_delegated_public_pool_descriptor_required");
  return nativeReadPoolSession(new Socket({fd,readable:true,writable:true}),expectedIdentity,'target');
}

// A separate constructor also permits direct socket fixtures. Production
// callers use only the fixed root-delegated inherited descriptor entry above.
export function nativeReadPoolSession(socket, expectedIdentity,poolKind='native') {
  need(socket instanceof Socket && expectedIdentity?.sourceRole?.name === "arena_native_reader"&&['native','target'].includes(poolKind), "actual_connected_native_pool_channel_required");
  const events = new EventEmitter(), requests = new Map();
  let counter = 0, active = false, ended = false, leaseTail = Promise.resolve();
  const fail = (error = Error("native_pool_channel_closed")) => { for (const request of requests.values()) { clearTimeout(request.timer); request.reject(error); } requests.clear(); };
  socket.on("error", fail); socket.on("close", () => { ended = true; fail(); });
  lines(socket, (message) => {
    need(message && message.format === POOL_FORMAT && requests.has(message.id), "same_native_pool_response_required");
    const request = requests.get(message.id); requests.delete(message.id); clearTimeout(request.timer);
    if (!message.ok) { const error = Error("native_pool_query_refused"); error.code = message.code; request.reject(error); }
    else request.resolve(message);
  }, (error) => { fail(error); socket.destroy(); });
  const ask = (value) => new Promise((resolve, reject) => {
    if (ended) { reject(Error("native_pool_channel_closed")); return; }
    const id = ++counter, timer = setTimeout(() => { socket.destroy(); reject(Error("bounded_native_pool_roundtrip_required")); }, LEASE_MILLISECONDS);
    requests.set(id, { resolve, reject, timer });
    try { send(socket, { format: POOL_FORMAT, id, ...value }); } catch (error) { clearTimeout(timer); requests.delete(id); reject(error); }
  });
  const pool = events;
  pool.connect = async () => {
    let unlock;
    const previous = leaseTail, own = new Promise((resolve) => { unlock = resolve; });
    leaseTail = previous.then(() => own);
    await previous;
    try { need(!active && !ended, "one_borrowed_native_pool_session_required"); }
    catch (error) { unlock(); throw error; }
    active = true;
    let response;
    try { response = await ask({ action: "connect", poolKind, identitySha256:identityHash(expectedIdentity) }); }
    catch (error) { active = false; unlock(); throw error; }
    if (response.poolKind!==poolKind || identityHash(response.identity) !== identityHash(expectedIdentity)) {
      socket.destroy(); active = false; unlock(); throw Error("same_actual_projector_source_pool_identity_required");
    }
    let released = false;
    return { query: async (text, values = []) => {
      need(!released, "native_pool_session_already_released");
      if (text && typeof text === "object") { need(Object.keys(text).every((key) => ["text", "values"].includes(key)), "plain_native_query_config_required"); values = text.values ?? []; text = text.text; }
      return decode((await ask({ action: "query", lease: response.lease, text: readQuery(text), values: encode(values) })).result);
    }, release: () => {
      need(!released, "one_native_pool_release_required"); released = true;
      // PG's release is synchronous. Queue the reset ACK before the next lease.
      pool._released = ask({ action: "release", lease: response.lease }).then(() => { active = false; unlock(); });
      pool._released.catch((error) => { active = false; unlock(); socket.destroy(); fail(error); });
    } };
  };
  pool.query = async (text, values) => { const client = await pool.connect(); try { return await client.query(text, values); } finally { client.release(); } };
  pool.end = async () => { if (pool._released) await pool._released; socket.destroy(); ended = true; };
  pool.sharedNativeReadPool = true;
  return pool;
}
