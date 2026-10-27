# Modern Arena artifact installation

This operator installs the frozen 1,796-file consumer release into a fresh,
unselected directory. It does not start services, change source selection, run
schema migrations or attach external island images. The source and manifest
identities are independently derived from the published baseline and build
overlay; runtime installation retains the existing checksum-aware helper.

First run the default read-only review with the actual successful package proof,
build review and builder source hashes:

```sh
python3 -B arena-modern-install-v1.py \
  --proof-sha256 ACTUAL_PROOF_SHA256 \
  --build-review ACTUAL_BUILD_REVIEW_HASH \
  --package-sha256 ACTUAL_BUILDER_SHA256
```

Apply by repeating those exact arguments with `--install ACTUAL_INSTALL_REVIEW_HASH`.
The build must be terminal and successful, both relocated credential and modern
acceptance suites must have run, and the source/runtime inventory must match.
The operator requires a 25 GB disk reserve and retains any partial fresh artifact
for reconciliation. It never overwrites an existing destination.

The installed public `install-result.json` binds the source, manifest, successful
build proof, runtime archive and inventory. It explicitly records zero service,
database and source-selection changes. Actual credential-context qualification,
runtime replacement, native adoption and production asset checks remain separate.

Run the offline admission controls with:

```sh
python3 -B ops/unified-indexer-transition/arena-modern-install-v1-test.py
```
