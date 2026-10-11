import ELK from 'elkjs/lib/elk-api.js';
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';

export type ElkApi = InstanceType<typeof ELK>;

/**
 * ELK runs in a Web Worker in the browser, so layout never blocks the main thread and the ~1.5 MB
 * engine stays out of the main bundle. Without Worker support (jsdom tests) the bundled build is
 * loaded on demand from a separate chunk.
 */
export async function loadElk(): Promise<ElkApi> {
  if (typeof Worker !== 'undefined') {
    return new ELK({ workerFactory: () => new Worker(elkWorkerUrl) });
  }
  const { default: BundledElk } = await import('elkjs/lib/elk.bundled.js');
  return new BundledElk();
}
