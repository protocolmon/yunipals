import { createHash } from "node:crypto";

import { migrations } from "@/db/migrations";

const history = migrations.map(({ version, name, sql }) => ({
  version,
  name,
  checksum: createHash("sha256").update(sql).digest("hex")
}));

console.log(JSON.stringify(history));
