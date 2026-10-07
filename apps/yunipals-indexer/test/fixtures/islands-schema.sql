CREATE SCHEMA metadata; CREATE SCHEMA metadata_source;
    CREATE TABLE metadata.chain_readiness(collection text PRIMARY KEY CHECK(collection IN ('ethereum','base','polygon','bnb')),
      state text NOT NULL,checkpoint_block numeric(78,0),reason text,updated_at timestamptz DEFAULT now(),verified_at timestamptz);
    CREATE TABLE metadata_source.source_blob(content_hash text PRIMARY KEY,payload jsonb NOT NULL,created_at timestamptz DEFAULT now());
    CREATE TABLE public.token(collection text,chain_id int,contract_address text,token_id text,owner text,burned boolean,lifecycle int,
      mint_block bigint,mint_timestamp bigint,last_transfer_block bigint,last_transfer_timestamp bigint,last_transaction_hash text,
      PRIMARY KEY(collection,token_id));
    CREATE TABLE public.token_lifecycle(collection text,token_id text,lifecycle int,minted_to text,mint_block bigint,mint_timestamp bigint,
      mint_transaction_hash text,burned_at_block bigint,burned_at_timestamp bigint,burn_transaction_hash text,PRIMARY KEY(collection,token_id,lifecycle));
    CREATE TABLE public.transfer_event(id text PRIMARY KEY,collection text,chain_id int,contract_address text,token_id text,lifecycle int,
      "from" text,"to" text,block_number bigint,block_timestamp bigint,transaction_hash text,transaction_index int,log_index int);
    CREATE TABLE public._ponder_checkpoint(chain_id bigint,latest_checkpoint text);
    CREATE TABLE public._ponder_meta(key text PRIMARY KEY,value jsonb);
