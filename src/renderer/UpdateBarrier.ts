type Flusher = () => void | Promise<void>;
const flushers = new Map<Flusher, number>();
export function registerUpdateFlusher(flush: Flusher, order = 1): () => void {
  flushers.set(flush, order);
  return () => {
    flushers.delete(flush);
  };
}
export async function flushUpdateState(): Promise<void> {
  for (const [flush] of [...flushers].sort((a, b) => a[1] - b[1]))
    await flush();
}
