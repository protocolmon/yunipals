// No environment files, clients, DB connections, signers or provider requests.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadLiveArenaCatalog } from "../../apps/yunipals-market-api/src/arena/live/catalog.ts";
import { loadIdentityProfiles } from "../../apps/yunipals-market-api/src/arena/live/identity.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const catalog = loadLiveArenaCatalog(root);
const profiles = loadIdentityProfiles(root);
assert.equal(catalog.islands.length, 898);
assert.equal(profiles.length, 4);
assert.match(catalog.rulesHash, /^0x[a-f0-9]{64}$/);
console.log(
  JSON.stringify({
    islands: 898,
    identityProfiles: profiles.length,
    rulesHash: catalog.rulesHash,
    poolHash: catalog.pool.sha256
  })
);
