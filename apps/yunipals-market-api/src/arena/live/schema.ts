import type { Pool } from "pg";
import { transaction } from "@/db/pool";
import { migrateArenaIdentities } from "./identitySchema";
import { migrateArenaDisclosure } from "./disclosureSchema";
import { migrateArenaDisclosureQueue } from "./disclosureQueueSchema";
import { migrateArenaTransactions } from "./transactionSchema";
import { migrateArenaClientTransactions } from "./clientTransactionSchema";
import { migrateArenaProviders } from "./providerSchema";
import { migrateArenaMedia } from "./mediaSchema";
import { migrateArenaSourceSelection } from "./sourceSelectionSchema";

// Independent schema on the existing PostgreSQL cluster. No marketplace tables altered.
export async function migrateArena(pool: Pool) {
  await transaction(pool, async (db) => {
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('yunipals_arena/migration'))"
    );
    await db.query(`
      CREATE SCHEMA IF NOT EXISTS yunipals_arena;
      CREATE TABLE IF NOT EXISTS yunipals_arena.deployment (
        id text PRIMARY KEY, contract text NOT NULL, start_block bigint NOT NULL,
        cursor bigint, cursor_hash text, finalized_at timestamptz,
        halted boolean NOT NULL DEFAULT false, halt_reason text
      );
      CREATE TABLE IF NOT EXISTS yunipals_arena.chain_event (
        deployment text NOT NULL REFERENCES yunipals_arena.deployment(id),
        block_number bigint NOT NULL, block_hash text NOT NULL,
        transaction_hash text NOT NULL, log_index integer NOT NULL,
        event_name text NOT NULL, args jsonb NOT NULL,
        PRIMARY KEY(deployment,transaction_hash,log_index)
      );
      CREATE INDEX IF NOT EXISTS arena_event_order ON yunipals_arena.chain_event(deployment,block_number,log_index);
      CREATE TABLE IF NOT EXISTS yunipals_arena.tournament (
        deployment text NOT NULL REFERENCES yunipals_arena.deployment(id), id numeric(78) NOT NULL,
        state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(deployment,id)
      );
      CREATE TABLE IF NOT EXISTS yunipals_arena.credit (
        deployment text NOT NULL, wallet text NOT NULL, amount numeric(78) NOT NULL CHECK(amount>=0),
        PRIMARY KEY(deployment,wallet)
      );
      CREATE TABLE IF NOT EXISTS yunipals_arena.challenge (
        id text PRIMARY KEY, deployment text NOT NULL, wallet text NOT NULL, message text NOT NULL,
        expires_at timestamptz NOT NULL, used_at timestamptz
      );
      CREATE TABLE IF NOT EXISTS yunipals_arena.session (
        token_hash text PRIMARY KEY, deployment text NOT NULL, wallet text NOT NULL, expires_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS yunipals_arena.submission (
        deployment text NOT NULL, tournament_id numeric(78) NOT NULL, seat smallint NOT NULL CHECK(seat BETWEEN 0 AND 3),
        wallet text NOT NULL, commitment text NOT NULL, signature text NOT NULL, ciphertext text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(deployment,tournament_id,seat),
        FOREIGN KEY(deployment,tournament_id) REFERENCES yunipals_arena.tournament(deployment,id)
      );
      ALTER TABLE yunipals_arena.submission ADD COLUMN IF NOT EXISTS loadout jsonb;
      CREATE TABLE IF NOT EXISTS yunipals_arena.fighter_snapshot (
        deployment text NOT NULL, tournament_id numeric(78) NOT NULL,
        nft_chain_id integer NOT NULL, collection text NOT NULL, token_id numeric(78) NOT NULL,
        snapshot jsonb NOT NULL, snapshot_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(deployment,tournament_id,nft_chain_id,collection,token_id),
        FOREIGN KEY(deployment,tournament_id) REFERENCES yunipals_arena.tournament(deployment,id)
      );
      CREATE TABLE IF NOT EXISTS yunipals_arena.frozen_input (
        deployment text NOT NULL, tournament_id numeric(78) NOT NULL, input_hash text NOT NULL,
        ciphertext text NOT NULL, revealed_at timestamptz,
        PRIMARY KEY(deployment,tournament_id),
        FOREIGN KEY(deployment,tournament_id) REFERENCES yunipals_arena.tournament(deployment,id)
      );
      CREATE TABLE IF NOT EXISTS yunipals_arena.admission (
        deployment text NOT NULL, tournament_id numeric(78) NOT NULL, wallet text NOT NULL,
        nft_chain_id integer NOT NULL, collection text NOT NULL, token_id numeric(78) NOT NULL,
        ownership_block bigint NOT NULL, ownership_hash text NOT NULL, expiry bigint NOT NULL, signature text NOT NULL,
        PRIMARY KEY(deployment,tournament_id,nft_chain_id,collection,token_id,wallet,expiry)
      );
      CREATE TABLE IF NOT EXISTS yunipals_arena.provider_task (
        deployment text NOT NULL, tournament_id numeric(78) NOT NULL, kind text NOT NULL, asset text NOT NULL,
        request_id text NOT NULL UNIQUE, state text NOT NULL DEFAULT 'reserved',
        provider_id text, request jsonb NOT NULL, response jsonb, error_code text,
        reserved_microusd bigint NOT NULL CHECK(reserved_microusd>=0), actual_microusd bigint,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(deployment,tournament_id,kind,asset)
      );
      CREATE TABLE IF NOT EXISTS yunipals_arena.transaction_intent (
        deployment text NOT NULL, purpose text NOT NULL, tournament_id numeric(78) NOT NULL,
        signer text NOT NULL, nonce bigint NOT NULL, raw_transaction text NOT NULL, tx_hash text NOT NULL,
        state text NOT NULL DEFAULT 'prepared', receipt jsonb,
        PRIMARY KEY(deployment,purpose,tournament_id), UNIQUE(deployment,signer,nonce)
      );
      CREATE TABLE IF NOT EXISTS yunipals_arena.adjudication (
        deployment text NOT NULL, tournament_id numeric(78) NOT NULL,
        input_hash text NOT NULL, outcome_hash text NOT NULL,
        candidate jsonb NOT NULL, validation jsonb NOT NULL,
        state text NOT NULL CHECK(state IN ('valid','invalid')), winners jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(deployment,tournament_id),
        FOREIGN KEY(deployment,tournament_id) REFERENCES yunipals_arena.tournament(deployment,id)
      );
      CREATE TABLE IF NOT EXISTS yunipals_arena.capacity (
        deployment text PRIMARY KEY REFERENCES yunipals_arena.deployment(id),
        snapshot jsonb NOT NULL, checked_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS yunipals_arena.media_job (
        deployment text NOT NULL, tournament_id numeric(78) NOT NULL,
        state text NOT NULL DEFAULT 'preparing', detail text,
        film_sha256 text, updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(deployment,tournament_id),
        FOREIGN KEY(deployment,tournament_id) REFERENCES yunipals_arena.tournament(deployment,id)
      );
      CREATE TABLE IF NOT EXISTS yunipals_arena.client_transaction (
        deployment text NOT NULL REFERENCES yunipals_arena.deployment(id),
        hash text NOT NULL, wallet text NOT NULL, action jsonb NOT NULL,
        state text NOT NULL DEFAULT 'submitted', result jsonb,
        indexed_through_block bigint, created_at timestamptz NOT NULL DEFAULT now(),
        tracking_until timestamptz NOT NULL DEFAULT now()+interval '2 hours',
        next_check_at timestamptz NOT NULL DEFAULT now(), checked_at timestamptz,
        PRIMARY KEY(deployment,hash)
      );
      CREATE INDEX IF NOT EXISTS arena_client_transaction_queue
        ON yunipals_arena.client_transaction(deployment,next_check_at)
        WHERE state IN ('submitted','confirming','indexing');
      CREATE INDEX IF NOT EXISTS arena_client_transaction_wallet
        ON yunipals_arena.client_transaction(deployment,wallet,created_at);
      CREATE TABLE IF NOT EXISTS yunipals_arena.identity_job (
        deployment text NOT NULL REFERENCES yunipals_arena.deployment(id),
        key text NOT NULL, wallet text NOT NULL, metadata jsonb NOT NULL,
        request_id text NOT NULL UNIQUE, state text NOT NULL DEFAULT 'queued',
        artwork bytea, profile jsonb, profile_hash text, provider_id text, usage jsonb,
        reserved_microusd bigint NOT NULL DEFAULT 0 CHECK(reserved_microusd>=0),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(deployment,key)
      );
      CREATE INDEX IF NOT EXISTS arena_identity_queue ON yunipals_arena.identity_job(deployment,state,created_at);
      ALTER TABLE yunipals_arena.identity_job ADD COLUMN IF NOT EXISTS profile_hash text;
    `);
    await migrateArenaIdentities(db);
    await migrateArenaDisclosure(db);
    await migrateArenaDisclosureQueue(db);
    await migrateArenaTransactions(db);
    await migrateArenaClientTransactions(db);
    await migrateArenaProviders(db);
    await migrateArenaMedia(db);
    await migrateArenaSourceSelection(db);
  });
}
