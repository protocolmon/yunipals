# Generation V5c

This successor preserves the V5b generation phase bodies, recovery transaction,
source and metadata checks, pool limit, disk reserve and backup exclusion window.
Its new identity paths distinguish its actual execution from unused V5b work.

`ypal-ordinary-generation-phase-v1.py` is the explicit production entry for the
unchanged V5c `main`. It permits up to480 seconds for a phase's repeated full
verification, rather than the original CLI wrapper's240 seconds. Arguments,
phase bodies, individual query/process limits,25-minute capacity supervision,
disk floors and backup exclusion are unchanged. The entry has its own source
hash in the root execution journal and does not claim the original CLI wrapper
executed. It never retries a phase or changes a timer.

The explicit metadata constructor binds
`ypal-ordinary-publication-query-v2.py`. Only the byte-identical full-publication
count gets a 60-second read-only statement limit. The original SQL compiler and
publication-proof body are authenticated and unchanged. Every other query keeps
its original limit. The original 10-second check timed out; a production read-only
measurement completed the same comparison in 37.734 seconds, matching 440,194
records. This measurement does not itself accept a generation or switch readers.

Use the actual metadata input, read admission, f81 installation and staged
selector receipts described in `ypal-ordinary-generation-v5b.next-commands.md`,
but invoke the explicit `ypal-ordinary-generation-phase-v1.py` entry. It calls
the authenticated V5c main with the same arguments. For completed provenance batch2,
use the actual hash of `provenance-2-observed.json`; the separate completion
producer records its ancestry without claiming the failed original phase passed.

Actual completed provenance receipt:
`6d8998f33db107a278097aff8b419cb0bea684151b2e73f7b72fc20a48906c1b`.
Actual staged selector receipt:
`451c497495c138e887bd95acfa426f40f5bf7194369ca22df42c85f6611b579b`.
Keep the existing f81 install acknowledgement on the host as the input source;
do not substitute the metadata-worker or Arena installation receipts.

The first review stopped before effects because the next Arena backup fell
inside the required build window. That backup completed successfully at
10:17:50UTC on25October; its timer stayed active and unchanged. A separate
post-backup review owns the next review hash. Do not reuse the failed review's
hash or repeat a drain/capsule/build with an unknown acknowledgement.

New operation directory:
`/var/backups/yunipals-ypal-ordinary-generation-v5c-20261025`.
New one-shot unit: `yunipals-ypal-ordinary-generation-prepare-v5c.service`.
The monitor remains bounded to 1,470 seconds with a 25 GB reserve, 30 GB abort
floor and no overlapping backup. Building does not publish the generation.

Eight generation controls and ten query/completion controls pass locally. Actual
selector staging, generation execution, current readiness and candidate acceptance
still require their real production receipts. Publication consumers must explicitly
route to this new producer; the V5b producer identity cannot stand in for it.
