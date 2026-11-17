import { onchainTable } from "ponder";

// Small, rollback-managed lookup tables for wallet eligibility counts. These
// are latest indexed state, never transaction authorization or future guarantees.
export const boosterCardFacts = onchainTable("booster_card_facts", (t) => ({
  id: t.text().primaryKey(),
  sequence: t.integer().notNull()
}));

export const portalEligibilityConfig = onchainTable(
  "portal_eligibility_config",
  (t) => ({
    id: t.hex().primaryKey(), // grading contract
    collection: t.hex().notNull(),
    cards: t.hex().notNull(),
    packTypeId: t.text("pack_type_id").notNull()
  })
);

export const portalEligibilityPortal = onchainTable(
  "portal_eligibility_portal",
  (t) => ({
    id: t.text().primaryKey(), // chain:collection:tokenId
    sequenceStart: t.integer("sequence_start").notNull(),
    sequenceLength: t.integer("sequence_length").notNull(),
    colorGate: t.integer("color_gate").notNull(),
    typeGate: t.integer("type_gate").notNull(),
    originalOnly: t.boolean("original_only").notNull(),
    glitterGate: t.boolean("glitter_gate").notNull(),
    diamondGate: t.boolean("diamond_gate").notNull(),
    retired: t.boolean().notNull()
  })
);

export const portalEligibilityPending = onchainTable(
  "portal_eligibility_pending",
  (t) => ({
    id: t.text().primaryKey(), // chain:grading:tokenId
    requestId: t.text("request_id").notNull()
  })
);
