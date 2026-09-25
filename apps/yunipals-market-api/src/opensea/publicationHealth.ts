import type { Pool } from "pg";
import type { OpenSeaChain } from "@protopals/yunipals-market-core/openseaRegistry";
import { marketplaceChains } from "@protopals/yunipals-market-core/registry";

export async function writeOpenSeaPublicationHeartbeat(
  pool: Pool,
  chain: OpenSeaChain,
  available: boolean
) {
  await pool.query(
    `INSERT INTO yunipals_market.checkpoint
    (source,chain_id,name,state,checked_at,last_error_code)
    VALUES('opensea',$1,'opensea-publication-worker',$2,clock_timestamp(),$3)
    ON CONFLICT(source,chain_id,name) DO UPDATE SET state=EXCLUDED.state,
      checked_at=EXCLUDED.checked_at,last_error_code=EXCLUDED.last_error_code,
      generation=yunipals_market.checkpoint.generation+1`,
    [
      marketplaceChains[chain].chainId,
      available ? "available" : "unavailable",
      available ? null : "publication_worker_stopped"
    ]
  );
}
