// Ponder 0.17.5 multichain reorgs only. The caller owns the rollback transaction.
// ALTER ... DISABLE/ENABLE TRIGGER takes SHARE ROW EXCLUSIVE, which permits
// catalog ACCESS SHARE locks. DROP/CREATE takes ACCESS EXCLUSIVE and can block
// the entire marketplace behind a retained pagination snapshot.
const quote = (name) => `"${name.replaceAll('"', '""')}"`;

export async function setReorgTriggersEnabled(tx, tables, schema, enabled) {
  const action = enabled ? "ENABLE" : "DISABLE";
  const targets = [
    ...tables.flatMap((table) =>
      ["reorg", "live_query"].map((trigger) => ({ ...table, trigger }))
    ),
    { schema, name: "_ponder_checkpoint", trigger: "live_query_notify" }
  ];
  for (const target of targets) {
    await tx.wrap({ label: "toggle_reorg_trigger" }, (db) =>
      db.execute(
        `ALTER TABLE ${quote(target.schema)}.${quote(target.name)} ${action} TRIGGER ${quote(target.trigger)}`
      )
    );
  }
}
