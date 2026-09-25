import type { Pool } from "pg";
import { marketplaceChains } from "@protopals/yunipals-market-core/registry";
import type { OpenSeaChain } from "@protopals/yunipals-market-core/openseaRegistry";

export type CapabilityHealth = {
  bnbWorker: boolean;
  openSeaRead: Record<OpenSeaChain, boolean>;
  openSeaPublication: Record<OpenSeaChain, boolean>;
};

export class CapabilityHealthService {
  private cached?: { at: number; value: CapabilityHealth };
  private pending?: Promise<CapabilityHealth>;

  constructor(
    private readonly pool: Pool,
    private readonly cacheMs = 2000
  ) {
    if (!Number.isSafeInteger(cacheMs) || cacheMs < 0 || cacheMs > 5000)
      throw new Error("Invalid capability health cache duration.");
  }

  async current(): Promise<CapabilityHealth> {
    if (this.cached && Date.now() - this.cached.at < this.cacheMs)
      return structuredClone(this.cached.value);
    if (this.pending) return structuredClone(await this.pending);
    this.pending = this.load();
    try {
      const value = await this.pending;
      this.cached = { at: Date.now(), value };
      return structuredClone(value);
    } finally {
      this.pending = undefined;
    }
  }

  private async load(): Promise<CapabilityHealth> {
    const rows = await this.pool.query<{
      chain_id: number;
      name: string;
      source: string;
      healthy: boolean;
    }>(
      `SELECT chain_id,name,source,
      state='available' AND checked_at>=clock_timestamp()-CASE
        WHEN name='opensea-publication-worker' THEN interval '15 seconds'
        WHEN source='indexer' THEN interval '16 minutes'
        ELSE interval '2 minutes' END
        AND last_error_code IS NULL AS healthy
      FROM yunipals_market.checkpoint
      WHERE (name='bnb-order-worker' AND chain_id=56 AND source='chain')
         OR (name='opensea-order-worker' AND source IN ('chain','indexer'))
         OR (name='opensea-publication-worker' AND source='opensea')`
    );
    const healthy = (chainId: number, name: string, sources: string[]) =>
      sources.every(
        (source) =>
          rows.rows.find(
            (row) =>
              row.chain_id === chainId &&
              row.name === name &&
              row.source === source
          )?.healthy === true
      );
    const openSeaRead = Object.fromEntries(
      (["ethereum", "base", "polygon"] as const).map((chain) => [
        chain,
        healthy(marketplaceChains[chain].chainId, "opensea-order-worker", [
          "chain",
          "indexer"
        ])
      ])
    ) as Record<OpenSeaChain, boolean>;
    const openSeaPublication = Object.fromEntries(
      (["ethereum", "base", "polygon"] as const).map((chain) => [
        chain,
        healthy(
          marketplaceChains[chain].chainId,
          "opensea-publication-worker",
          ["opensea"]
        )
      ])
    ) as Record<OpenSeaChain, boolean>;
    return {
      bnbWorker: healthy(56, "bnb-order-worker", ["chain"]),
      openSeaRead,
      openSeaPublication
    };
  }
}
