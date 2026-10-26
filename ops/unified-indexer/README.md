# Yunipals indexer operations

The supported setup and operations guide is [the indexer README](../../apps/yunipals-indexer/README.md). Start the managed Ponder and Solana service from the repository root:

```sh
pnpm indexer:start --env-file /etc/yunipals-unified/indexer.service.env
```

`service.env.example` contains public supervisor settings. `apps/yunipals-indexer/.env.example` and `solana.env.example` describe the separate private child files. `yunipals-indexer.service.example` runs the same launcher under systemd. `run-indexer.sh` supervises the existing Ponder and Solana entrypoints; it is invoked by the launcher.
