export const portalConsumerSchema = `CREATE TABLE IF NOT EXISTS portal_v6_consumer (
 deployment text PRIMARY KEY, identity text NOT NULL, block_number numeric(20,0) NOT NULL,
 block_hash text NOT NULL, transaction_index integer NOT NULL, log_index integer NOT NULL
);
CREATE TABLE IF NOT EXISTS portal_v6_job_revision (
 deployment text NOT NULL, request_id numeric(78,0) NOT NULL, binding text NOT NULL,
 job jsonb NOT NULL, saved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(deployment,request_id,binding)
);`;
