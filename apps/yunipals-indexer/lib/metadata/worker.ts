import { metadataSourceMode } from "./publication.js";
import { pool } from "../offchain/db.js";
import { assertOwnershipSourceSelection } from "../ownership/readiness.js";
await assertOwnershipSourceSelection(pool);
if (metadataSourceMode() === "archive") await import("./archive-worker.js");
else await import("./legacy-http-worker.js");
