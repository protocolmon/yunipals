import { pool } from "../lib/offchain/db.js";
import { archiveManifest } from "../lib/solana/worker.js";

try {
  const {release,assets,checksum}=await archiveManifest();
  console.log(JSON.stringify({release,assetCount:assets.length,checksum}));
} catch {
  console.error("solana_manifest_audit_failed");
  process.exitCode=1;
} finally { await pool.end(); }
