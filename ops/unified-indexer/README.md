# Yunipals indexer operations

The supported setup and operations guide is [the indexer README](../../apps/yunipals-indexer/README.md). Start the managed Ponder and Solana service from the repository root:

```sh
pnpm indexer:start --env-file /etc/yunipals-unified/indexer.service.env
```

`service.env.example` contains public supervisor settings. `apps/yunipals-indexer/.env.example` and `solana.env.example` describe the separate private child files. `yunipals-indexer.service.example` runs the same launcher under systemd. `run-indexer.sh` supervises the existing Ponder and Solana entrypoints; it is invoked by the launcher.

The Arena v2 consolidation uses [the shared transition guide](shared-transition.md)
and [the implementation plan](../../docs/unified-indexer/shared-indexer-arena-v2-transition-plan-2026-11-02.md).
There is one canonical Ponder process for all four EVM chains and both Arena v2
modes. Additional Arena source services are qualification tools to retire after
handover, not permanent deployments. The existing managed Solana child remains.
