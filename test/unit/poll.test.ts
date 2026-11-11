import { describe, expect, it, vi } from 'vitest';
import { waitForUpdate } from '../../src/api/poll';
import type { Update } from '../../src/api/types';
import { update } from './fixtures';

describe('waitForUpdate', () => {
  it('returns immediately when the update is already complete', async () => {
    const read = vi.fn();
    const done = update();
    expect(await waitForUpdate({ read } as never, done, { intervalMs: 1 })).toBe(done);
    expect(read).not.toHaveBeenCalled();
  });

  it('polls GetUpdate until the update is complete', async () => {
    const states: Update[] = [
      update({ status: 'InProgress', logs: [] }),
      update({ status: 'Complete', success: false }),
    ];
    const read = vi.fn(async () => states.shift()!);
    const progress = vi.fn();
    const result = await waitForUpdate({ read } as never, update({ status: 'Queued', logs: [] }), {
      intervalMs: 1,
      onProgress: progress,
    });
    expect(result.status).toBe('Complete');
    expect(result.success).toBe(false);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledWith('GetUpdate', { id: '6731f0c2a1b2c3d4e5f60718' }, undefined);
    expect(progress).toHaveBeenCalledTimes(2);
  });

  it('stops when aborted', async () => {
    const read = vi.fn(async () => update({ status: 'InProgress' }));
    const controller = new AbortController();
    const pending = waitForUpdate({ read } as never, update({ status: 'InProgress' }), {
      intervalMs: 5,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 12);
    await expect(pending).rejects.toBeDefined();
  });
});
