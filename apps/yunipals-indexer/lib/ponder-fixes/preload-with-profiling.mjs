// The launcher accepts one preload. Order matters: the profiler checks the
// checksum of the source it receives, so its hook must be registered first and
// therefore run closest to the file on disk.
import "../profiling/preload.mjs";
import "./preload.mjs";
