-- Claude stores its OpenRouter generation ID separately from response content.
-- Apply on the operational Arena database after creating the shared anime role.
BEGIN;
SET LOCAL lock_timeout = '2s';
GRANT UPDATE (provider_id) ON TABLE yunipals_arena.provider_task
  TO yunipals_arena_v2_anime_media;
COMMIT;
