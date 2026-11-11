import type { KomodoClient } from './client';
import type { Update } from './types';

export interface WaitOptions {
  /** Delay between `GetUpdate` polls. Default 1000ms. */
  intervalMs?: number;
  signal?: AbortSignal;
  /** Called after every poll with the latest state of the update. */
  onProgress?: (update: Update) => void;
}

export function updateId(update: Update): string | undefined {
  return update._id?.$oid;
}

/** Polls `GetUpdate` until the execution is `Complete`, then returns the final update (with logs). */
export async function waitForUpdate(
  client: Pick<KomodoClient, 'read'>,
  initial: Update,
  options: WaitOptions = {},
): Promise<Update> {
  let update = initial;
  const id = updateId(initial);
  if (!id) {
    return update;
  }
  const interval = options.intervalMs ?? 1000;
  while (update.status !== 'Complete') {
    await sleep(interval, options.signal);
    update = await client.read('GetUpdate', { id }, options.signal);
    options.onProgress?.(update);
  }
  return update;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('Aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
