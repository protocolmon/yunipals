# Generation V5c

This successor preserves the V5b generation phase bodies, recovery transaction,
source and metadata checks, pool limit, disk reserve and backup exclusion window.
Its new identity paths distinguish its actual execution from unused V5b work.

The explicit metadata constructor binds
`ypal-ordinary-publication-query-v2.py`. Only the byte-identical full-publication
count gets a 60-second read-only statement limit. The original SQL compiler and
publication-proof body are authenticated and unchanged. Every other query keeps
its original limit. The original 10-second check timed out; a production read-only
measurement completed the same comparison in 37.734 seconds, matching 440,194
records. This measurement does not itself accept a generation or switch readers.

Use the actual metadata input, read admission, f81 installation and staged
selector receipts described in `ypal-ordinary-generation-v5b.next-commands.md`,
but invoke `ypal-ordinary-generation-v5c.py`. For completed provenance batch 2,
use the actual hash of `provenance-2-observed.json`; the separate completion
producer records its ancestry without claiming the failed original phase passed.

New operation directory:
`/var/backups/yunipals-ypal-ordinary-generation-v5c-20261025`.
New one-shot unit: `yunipals-ypal-ordinary-generation-prepare-v5c.service`.
The monitor remains bounded to 1,470 seconds with a 25 GB reserve, 30 GB abort
floor and no overlapping backup. Building does not publish the generation.

Eight generation controls and ten query/completion controls pass locally. Actual
selector staging, generation execution, current readiness and candidate acceptance
still require their real production receipts. Publication consumers must explicitly
route to this new producer; the V5b producer identity cannot stand in for it.
