#!/usr/bin/env python3
"""Bounded pure SHA256 computation reuse over freshly supplied exact bytes."""
import _thread
import hashlib
import json
import types

FORMAT = "yunipals-readonly-sha256-memo-v1"
MINIMUM_INPUT_BYTES = 1024 * 1024
MAXIMUM_PAYLOAD_BYTES = 256 * 1024 * 1024
MAXIMUM_ENTRIES = 4
_ORIGINAL_SHA256 = hashlib.sha256
_CACHE_ERRORS = (MemoryError, OSError, TypeError, ValueError, AttributeError, OverflowError)


class SHA256Memo:
    """Cache computation, never file identity or a source/current observation.

    A cache entry retains exact immutable bytes and a private, never-updated
    copy of their original hash state. Every hit requires exact byte equality
    and returns another independent original-type copy. Unsupported calls
    execute their unchanged original constructor once. No payload, path,
    digest, argument or exception message appears in the scalar snapshot.
    """

    def __init__(self, maximum_payload_bytes=MAXIMUM_PAYLOAD_BYTES, maximum_entries=MAXIMUM_ENTRIES):
        if type(maximum_payload_bytes) is not int or not MINIMUM_INPUT_BYTES <= maximum_payload_bytes <= MAXIMUM_PAYLOAD_BYTES:
            raise ValueError("bounded_private_SHA256_payload_limit_required")
        if type(maximum_entries) is not int or not 1 <= maximum_entries <= MAXIMUM_ENTRIES:
            raise ValueError("bounded_private_SHA256_entry_limit_required")
        self.maximum_payload_bytes = maximum_payload_bytes
        self.maximum_entries = maximum_entries
        self.entered = False
        self.active = False
        self.restored = False
        self.hook_changed = False
        self.thread = None
        self.installed = None
        self._entries = []
        self._tick = 0
        self._entries_at_close = 0
        self._payload_at_close = 0
        self.counts = {name: 0 for name in [
            "observedCalls", "foreignThreadCallsDelegated", "unsupportedCallsDelegated",
            "smallInputsDelegated", "oversizeInputsDelegated", "cacheableLargeCalls",
            "cacheLookupMisses", "cacheHits", "cacheLookupOrCopyRefusals", "originalConstructorCalls",
            "largeInputBytesSubmittedToOriginal", "largeInputBytesAvoidedByHits",
            "entriesStored", "entriesEvicted", "peakRetainedPayloadBytes", "bookkeepingErrors"
        ]}

    def __enter__(self):
        if self.entered or hashlib.sha256 is not _ORIGINAL_SHA256 or type(_ORIGINAL_SHA256) is not types.BuiltinFunctionType or (
                _ORIGINAL_SHA256.__module__, _ORIGINAL_SHA256.__name__) != ("_hashlib", "openssl_sha256"):
            raise RuntimeError("fresh_scope_and_unwrapped_original_OpenSSL_SHA256_constructor_required")
        self.entered = True
        self.thread = _thread.get_ident()

        def observed(*args, **kwargs):
            return self._observe(_ORIGINAL_SHA256, args, kwargs)

        self.installed = observed
        hashlib.sha256 = observed
        self.active = True
        return self

    def __exit__(self, _kind, _error, _traceback):
        if not self.active:
            raise RuntimeError("active_owned_SHA256_memo_scope_required")
        self.hook_changed = hashlib.sha256 is not self.installed
        # Restore before releasing payloads, taking a snapshot or writing.
        hashlib.sha256 = _ORIGINAL_SHA256
        self.active = False
        self.restored = hashlib.sha256 is _ORIGINAL_SHA256
        try:
            self._entries_at_close = len(self._entries)
            self._payload_at_close = sum(len(entry[1]) for entry in self._entries)
        except _CACHE_ERRORS:
            self._note_error()
        finally:
            self._entries.clear()
        return False

    def _add(self, name, amount=1):
        try:
            self.counts[name] += amount
        except _CACHE_ERRORS:
            self._note_error()

    def _note_error(self):
        try:
            self.counts["bookkeepingErrors"] += 1
        except _CACHE_ERRORS:
            pass

    @staticmethod
    def _supported(args, kwargs):
        if len(args) != 1 or type(args[0]) is not bytes:
            return None
        # Avoid equality/stringification on unknown keyword-key objects.
        if not kwargs:
            return args[0], "implicit-usedforsecurity"
        if len(kwargs) == 1:
            key = next(iter(kwargs))
            if type(key) is str and key == "usedforsecurity" and type(kwargs[key]) is bool:
                return args[0], "explicit-usedforsecurity-true" if kwargs[key] else "explicit-usedforsecurity-false"
        return None

    @staticmethod
    def _copy_state(state):
        value = state.copy()
        if type(value) is not type(state) or value is state:
            raise TypeError("independent_original_type_SHA256_copy_required")
        return value

    def _lookup(self, raw, mode):
        for index, entry in enumerate(self._entries):
            # Both operands are exact builtin bytes; no path/stat/digest key.
            if entry[0] == mode and len(entry[1]) == len(raw) and entry[1] == raw:
                return index, entry
        return None

    def _store(self, raw, mode, state):
        retained = sum(len(entry[1]) for entry in self._entries)
        while len(self._entries) >= self.maximum_entries or retained + len(raw) > self.maximum_payload_bytes:
            oldest = min(range(len(self._entries)), key=lambda index: self._entries[index][3])
            retained -= len(self._entries[oldest][1])
            del self._entries[oldest]
            self._add("entriesEvicted")
        self._tick += 1
        self._entries.append((mode, raw, state, self._tick))
        self._add("entriesStored")
        self.counts["peakRetainedPayloadBytes"] = max(self.counts["peakRetainedPayloadBytes"], retained + len(raw))

    def _original(self, original, args, kwargs, large_bytes=0):
        self._add("originalConstructorCalls")
        self._add("largeInputBytesSubmittedToOriginal", large_bytes)
        # Original errors are outside every optional-cache exception handler.
        return original(*args, **kwargs)

    def _observe(self, original, args, kwargs):
        # An imported alias captured by a fresh namespace must remain safe
        # after this scope closes: no cache, payload retention or new counters.
        if not self.active:
            return original(*args, **kwargs)
        if _thread.get_ident() != self.thread:
            self._add("foreignThreadCallsDelegated")
            return original(*args, **kwargs)
        self._add("observedCalls")
        try:
            supported = self._supported(args, kwargs)
        except _CACHE_ERRORS:
            self._note_error()
            return self._original(original, args, kwargs)
        if supported is None:
            self._add("unsupportedCallsDelegated")
            return self._original(original, args, kwargs)
        raw, mode = supported
        size = len(raw)
        if size < MINIMUM_INPUT_BYTES:
            self._add("smallInputsDelegated")
            return self._original(original, args, kwargs)
        if size > self.maximum_payload_bytes:
            self._add("oversizeInputsDelegated")
            return self._original(original, args, kwargs, size)
        self._add("cacheableLargeCalls")
        try:
            found = self._lookup(raw, mode)
            if found is not None:
                index, entry = found
                value = self._copy_state(entry[2])
        except _CACHE_ERRORS:
            self._note_error()
            self._add("cacheLookupOrCopyRefusals")
            return self._original(original, args, kwargs, size)
        if found is not None:
            self._add("cacheHits")
            self._add("largeInputBytesAvoidedByHits", size)
            try:
                self._tick += 1
                self._entries[index] = (entry[0], entry[1], entry[2], self._tick)
            except _CACHE_ERRORS:
                self._note_error()
            return value
        self._add("cacheLookupMisses")
        value = self._original(original, args, kwargs, size)
        try:
            self._store(raw, mode, self._copy_state(value))
        except _CACHE_ERRORS:
            self._note_error()
        return value

    def snapshot(self):
        if self.active:
            raise RuntimeError("SHA256_memo_snapshot_only_after_original_constructor_restored")
        return {
            "format": FORMAT, **dict(self.counts),
            "minimumInputBytes": MINIMUM_INPUT_BYTES,
            "maximumPayloadBytes": self.maximum_payload_bytes,
            "maximumEntries": self.maximum_entries,
            "entriesAtClose": self._entries_at_close,
            "retainedPayloadBytesAtClose": self._payload_at_close,
            "retainedPayloadBytesNow": sum(len(entry[1]) for entry in self._entries),
            "privatePayloadsReleased": not self.active and not self._entries,
            "originalSHA256Restored": self.restored and hashlib.sha256 is _ORIGINAL_SHA256,
            "SHA256HookChangedDuringScope": self.hook_changed,
            "currentThreadOnly": True,
            "exactBuiltinFreshByteEqualityRequired": True,
            "keywordModesKeptSeparate": True,
            "independentOriginalTypeCopiesReturned": True,
            "payloadLimitIncludesPythonOrOpenSSLObjectOverhead": False,
            "rawBytesPathsDigestsOrExceptionMessagesExported": False,
            "mutableInputsCached": False, "fileMetadataUsedForHits": False,
            "sourceOrActorOrCatalogOrReadinessFactsCached": False,
            "compileJSONApplicationOrProfileHooksInstalled": False,
            "deadlinesChanged": False, "automaticRetryAllowed": False,
            "currentOrTimingOrSQLAuthorityQualified": False,
            "effectsDispatchedByHelper": False
        }


if __name__ == "__main__":
    print(json.dumps({"format": FORMAT, "staticOnly": True,
        "SHA256MemoInstalled": False, "effectsDispatchedByHelper": False}))
