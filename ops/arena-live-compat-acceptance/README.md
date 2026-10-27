# Live Arena compatibility acceptance

Run against this worktree's actual application modules and dynamic public inputs:

```sh
cd apps/yunipals-market-api
/root/.nvm/versions/node/v24.18.1/bin/node --import tsx ../../ops/arena-live-compat-acceptance/run.ts
```

The 21 tests do not start services, connect to PostgreSQL, use a wallet, read production credentials, or contact providers. HTTP requests use Hono's in-process request API. Database and point-read dependencies are strict synthetic fixtures; unplanned SQL or remote fetches fail.

Acceptance requires the real catalog computation to equal deployed rules hash `0x46a4dc89a248047d27c6b02d208c5d2866e843280ef2803294384850edb06c80` and the complete published manifest. A changed temporary public validator input must change that computation. Other checks exercise public/pilot configuration, capped/ongoing funding and capacity gates, cached artwork preparation, wallet forwarding, modern public history/rewards, and native film selectors. Native guards cover source-epoch leases, canonical point checks, durable opening identities, provider-effect claims and artwork funding denial before a new POST.

Unified public history must use canonical browse frames and repeat their fixed anchor before responding. Private enrichments must carry the current incarnation, and operational public projections are forbidden. Missing or changing native frames return 503. The old legacy actor must also refuse public history after its source fence changes.

These are offline compatibility gates. They do not claim live database parity, provider funding, successful paid inference, production runtime readiness or a completed migration.
