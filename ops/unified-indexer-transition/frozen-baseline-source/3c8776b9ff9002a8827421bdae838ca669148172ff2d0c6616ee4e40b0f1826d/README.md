# Frozen public runtime baseline

This is the unchanged public source baseline required by the migration build
operators. It is historical source, not the current working application or a new
runtime release. Keep its original files byte-identical.

- Source inventory digest: `3c8776b9ff9002a8827421bdae838ca669148172ff2d0c6616ee4e40b0f1826d`.
- Original archive: `source.tar.gz`, 2,202,375 bytes, SHA-256
  `af09ea5b6f557f582e5203dbca38eed6641280bc5b5f49ee180a76b528a7aa2f`.
- Original release manifest SHA-256:
  `1cdf261d411007868ad1f026a58cae381b02c5f92c6a9a45da30e9867e9f7df8`.

The archive contains exactly 1,746 inventory files (10,278,498 bytes), the original
`RELEASE-MANIFEST.json` and `SHA256SUMS`. Every inventory path, length and SHA-256
was verified. Paths are relative and unique; only regular files and directories
are present. No links, devices, traversal paths or unlisted source files exist.
The source digest is SHA-256 of the original manifest's `files` array serialized
with `json.dumps(files, indent=2, ensure_ascii=False)` and a final newline.

An audit of locally retained `origin` history found exact bytes for 1,612 files,
while 134 files were missing, including 22 application files and four package
files. The archive preserves those historical bytes without substituting current
code. The comparison scope, exact origin refs and missing-file inventory are in
`verification.json`; it does not claim to query arbitrary remote branches.

All 1,748 safely extracted files passed Gitleaks 8.30.1 using the repository's
reviewed configuration, with zero findings. No private runtime environment or
database export was added. Public templates and documentation remain part of the
original source snapshot. The embedded `EXTERNAL-RUNTIME-ASSETS.json` lists
retained public media that is intentionally outside this source archive; private
configuration and generated deployment artifacts remain separate inputs.

To inspect, first verify the archive and manifest against the hashes above, then
extract into an empty temporary directory. Inside that directory run
`sha256sum --check SHA256SUMS`; all 1,746 entries must pass. Use the exact original
archive for operators that pin its digest. This preservation performs no runtime,
service, database, provider or Git changes.
