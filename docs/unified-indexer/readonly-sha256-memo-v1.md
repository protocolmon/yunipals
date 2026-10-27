# Bounded SHA256 computation reuse over fresh bytes

`ypal-readonly-sha256-memo-v1.py` reuses only deterministic SHA256 computation inside an explicitly owned scope. It does not reuse a Source validation, file observation, actor, catalog, readiness proof or approval. Each caller still reads its actual bytes and executes its original expected-digest comparison and every other predicate. A hit requires exact equality of the newly supplied bytes with retained immutable bytes; a path, inode, timestamp, Python hash, previously computed digest or matching length alone cannot authorize a hit.

The API is:

```python
memo = helper.SHA256Memo(
    maximum_payload_bytes=256 * 1024 * 1024,
    maximum_entries=4
)
with memo:
    # Only separately reviewed genuine work; all reads/checks still execute.
    refresh = host.refresh()
    prerequisites = host.prerequisites()
private_counters = memo.snapshot()
```

The scope requires the fixed, unwrapped original `_hashlib.openssl_sha256` constructor. It caches only a call with one positional exact builtin `bytes` object of at least 1 MiB, with empty kwargs or exactly `usedforsecurity` set to an exact bool. Implicit security mode, explicit True and explicit False have separate entries. Small inputs, oversized inputs, byte subclasses, mutable inputs, memoryviews, keyword `string` inputs, unknown argument shapes and unknown security values delegate to the unchanged original constructor once. Their arguments, original results and original exceptions pass through. A failed original constructor is never cached or called a second time by the helper.

On a miss the original constructor computes the hash first. The caller receives that original object. Only a separate private `hash.copy()` is retained, and a finite optional cache-save refusal still returns the already computed original object. On a hit, the helper returns another independent original-type copy. Caller `update`, `copy`, `digest` and `hexdigest` operations cannot mutate the cached state or another caller's state. A finite lookup/copy refusal can fall back to one original constructor call because none has yet run for that hit. External deadlines and cancellation propagate instead of being interpreted as cache misses.

At most four entries are retained. An exact-byte scan checks at most those four entries, and least-recently-used eviction enforces both the entry limit and the configured retained-payload limit, at most 256 MiB. The payload count is the sum of retained byte lengths, conservatively counting references in separate security-mode entries. It does not include Python/OpenSSL object overhead or claim a process RSS bound; original callers can independently retain their own buffers and hash objects. Those caller allocations are outside the cache. The helper retains no growing per-call log.

The original public constructor is restored before optional close counters, snapshots or writes. Cached byte references and private hash states are then cleared on both outcomes. A fresh namespace that captured the scoped SHA function continues to delegate directly to the original after exit, without caching, retaining new payloads or changing the finished counters. Current-thread-only caching leaves foreign-thread calls on the original constructor. Reused scopes and prewrapped constructors refuse entry. If the hook changes during the scope, the snapshot reports that fact after restoring the original.

Optional finite bookkeeping failures increment an error counter and cannot replace an original body error. Close-counter collection has the same finite guard and always clears payloads. Runtime deadlines and cancellation remain outside that finite set and still propagate. The snapshot contains fixed scalar limits, hit/miss/copy/refusal/eviction counts, submitted and avoided input-byte counts, payload high-water marks, restoration and coverage flags. It exports no raw bytes, path, input digest or exception message. Submitted-byte counters describe inputs sent to the original constructor, not a claim that an exceptional constructor completed all hashing. Avoided-byte counters count only successful exact-byte hits returning an independent state copy; file reads and byte comparisons still occur.

This is the sole SHA hook in a future separately reviewed measurement. CPU2 also owns that same public constructor and must not be nested with this helper. Run timer2 can surround it: construct both objects first, enter run timer then memo, restore both before private snapshots/writes and genuine full Source postflight. There are no compile, JSON, profile, trace, frame, stack, Popen, pipe, SQL-parent or application-function hooks. No original query, current/source/metadata predicate, approval lifetime, deadline, reserve or effect protocol is changed. This packet grants no production performance, current, callback, SQL, prepared ACK, timing or commit authority.

The motivating actual read-only benchmark3 `4d0eb095` measured 10.996586389 seconds in 13,453 SHA256 construction calls across all input sizes. It did not report which calls satisfy this helper's size/shape policy or how often their freshly supplied bytes repeat. That total is not a predicted saving. The roughly 24.400 seconds of CPU outside the five observed entrypoints also remain unattributed. A future actual measurement must report its own hit counts, avoided computation bytes, errors, memory limits, genuine full current checks and Source/file bookends; it cannot treat a successful local fixture as production acceptance.

Fourteen portable controls run with:

```sh
python3 -I -B ops/unified-indexer-transition/ypal-readonly-sha256-memo-v1.test.py
```

They use genuine OpenSSL SHA256 objects and known crypto vectors; independent update/copy state; exact fresh-byte equality and separate security modes; same-inode/size/restored-mtime file mutation refusing the old expected digest; real entry/payload eviction; unsupported/mutable/subclass forwarding; miss-save and hit-copy refusal; exact original error identity and cancellation; alias capture and independent fresh namespaces; foreign threads; restoration; scalar-only snapshots; and original-error preservation under a close-counter MemoryError. Explicit failure injection is limited to those stated cache/constructor/bookkeeping boundaries. No Source, Host, database, service or application operation is invoked.

`ypal-readonly-sha256-memo-v1.local-performance.py` supplies a bounded local performance check. It creates two generated public-byte files of 16 MiB by default (allowed 16–32 MiB), then performs six genuinely fresh `read_bytes()` calls per measurement. Every plain and memoized iteration checks the same original digest and independent copy/update results. Three rounds alternate which mode runs first. The co-located scalar result records plain CPU 0.082296122, 0.076369659 and 0.082837676 seconds; memo CPU 0.064564379, 0.058996525 and 0.064998301 seconds. Median ratio was 0.784537320 in this local generated workload. Every memoized measurement made two original large-input constructor calls and four hits, avoiding 64 MiB of SHA input computation while still rereading all 96 MiB, with a 32 MiB retained-payload peak and zero bookkeeping errors. A separate untimed 16 MiB budget control produced three hits and two evictions. Both scopes restored the original constructor and released payloads. This small local benefit establishes neither production savings nor that any held callback fits its original deadline.

The finite packet contains the helper, fourteen controls, bounded local performance script, scalar local result and this document. Only the helper is a runtime deployment target, with no nonstdlib dependency. Publication, staging, actual measurement and any later adoption remain separate Root-owned actions.
