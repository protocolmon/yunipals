import { describe, expect, it, vi } from 'vitest';
import { chainReadiness } from '../lib/metadata/chain-readiness.js';

describe('archive ownership readiness', () => {
  const chains = ['ethereum', 'base', 'polygon', 'bnb'] as const;

  it('requires an explicitly verified checkpoint for every selected chain', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [
      { collection: 'ethereum', state: 'ready', checkpoint_block: '100', verified_at: new Date() },
      { collection: 'base', state: 'ready', checkpoint_block: null, verified_at: new Date() },
      { collection: 'polygon', state: 'rebuilding', checkpoint_block: '100', verified_at: null }
    ] });
    const result = await chainReadiness({ query } as never, chains);
    expect(result.ready).toBe(false);
    expect(result.blocked).toEqual(['base', 'polygon', 'bnb']);
    expect(query).toHaveBeenCalledOnce();
  });

  it('accepts all four verified ready rows', async () => {
    const query = vi.fn().mockResolvedValue({ rows: chains.map(collection => ({
      collection, state: 'ready', checkpoint_block: '100', verified_at: new Date()
    })) });
    expect(await chainReadiness({ query } as never, chains)).toMatchObject({ ready: true, blocked: [] });
  });
});
