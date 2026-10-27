BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
SET LOCAL ROLE arena_public_rollback_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA yunipals_arena AUTHORIZATION arena_public_rollback_owner;
CREATE TABLE yunipals_arena.deployment (
  id text PRIMARY KEY,
  contract text NOT NULL,
  start_block bigint NOT NULL,
  cursor bigint,
  cursor_hash text,
  finalized_at timestamptz,
  halted boolean NOT NULL DEFAULT false,
  halt_reason text,
  indexer_mode text NOT NULL DEFAULT 'legacy' CHECK (indexer_mode='legacy'),
  CHECK (id='8453:0xebd141b6ae36f74fe70b9139b262ee9771b72aca'),
  CHECK (contract='0xebd141b6ae36f74fe70b9139b262ee9771b72aca'),
  CHECK (start_block=52648146),
  CHECK ((cursor IS NULL AND cursor_hash IS NULL) OR (cursor>=start_block AND cursor_hash ~ '^0x[0-9a-f]{64}$'))
);
CREATE TABLE yunipals_arena.chain_event (
  deployment text NOT NULL REFERENCES yunipals_arena.deployment(id),
  block_number bigint NOT NULL CHECK (block_number>=52648146),
  block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer NOT NULL CHECK (log_index>=0),
  event_name text NOT NULL,
  args jsonb NOT NULL CHECK (jsonb_typeof(args)='object'),
  PRIMARY KEY(deployment,transaction_hash,log_index)
);
CREATE INDEX arena_event_order ON yunipals_arena.chain_event(deployment,block_number,log_index);
CREATE TABLE yunipals_arena.tournament (
  deployment text NOT NULL REFERENCES yunipals_arena.deployment(id),
  id numeric(78) NOT NULL CHECK (id>=0),
  state jsonb NOT NULL CHECK (jsonb_typeof(state)='object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(deployment,id)
);
CREATE TABLE yunipals_arena.credit (
  deployment text NOT NULL REFERENCES yunipals_arena.deployment(id),
  wallet text NOT NULL CHECK (wallet ~ '^0x[0-9a-f]{40}$'),
  amount numeric(78) NOT NULL CHECK (amount>=0),
  PRIMARY KEY(deployment,wallet)
);
GRANT USAGE ON SCHEMA yunipals_arena TO arena_public_rollback_writer,arena_public_rollback_reader;
GRANT SELECT,INSERT ON yunipals_arena.chain_event TO arena_public_rollback_writer;
GRANT SELECT,INSERT,UPDATE ON yunipals_arena.deployment,yunipals_arena.tournament,yunipals_arena.credit TO arena_public_rollback_writer;
GRANT SELECT ON yunipals_arena.deployment,yunipals_arena.chain_event,yunipals_arena.tournament,yunipals_arena.credit TO arena_public_rollback_reader;
RESET ROLE;
COMMIT;
