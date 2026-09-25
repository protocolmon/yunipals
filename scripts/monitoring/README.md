# Health monitor contracts

`health_contract.py` validates the approved frontend manifest and 30-day listing
policies. Run its regression checks with:

```sh
python3 -m unittest discover -s scripts/monitoring -p 'test_*.py'
```

Keep deployment-specific manifests and the production monitor configuration in
private operational storage. A frontend manifest contains `formatVersion: 1`,
`gitRevision`, `deploymentId`, `htmlSha256`, `jsPath` and `jsSha256`.
Update it as part of promoting an approved release, after checking that the live
assets match the approved build. Do not automatically approve whatever content a
public URL returns. Invalid manifests must produce a configuration error; changed
artifacts must remain detectable.

The API emits `market_policy_resolution` JSON diagnostics with chain, purpose,
cache hit, outcome and timing for database acquisition/selection, upstream fetch
and lease waiting. Total time also includes result persistence and validation.
Only the foreground API resolver uses a four-second refresh deadline; workers
retain their existing background budgets. Cached observations retain their original
expiry, and stale or failed policy checks do not authorize transactions. Provider
cancellation and shared retry/backoff coordination remain in force.
