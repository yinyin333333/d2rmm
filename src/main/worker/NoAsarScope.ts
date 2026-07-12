let noAsarQueue = Promise.resolve();

/**
 * Runs an operation while Electron's process-wide ASAR handling is disabled.
 *
 * `process.noAsar` is global, so overlapping callers must be serialized or one
 * caller can restore the flag while another caller is still using it.
 */
export async function withNoAsar<T>(
  operation: () => Promise<T> | T,
): Promise<T> {
  let releaseQueue: () => void = () => undefined;
  const queueTurn = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  const previousTurn = noAsarQueue;
  noAsarQueue = previousTurn.then(() => queueTurn);

  await previousTurn;

  const previousNoAsar = process.noAsar;
  process.noAsar = true;
  try {
    return await operation();
  } finally {
    try {
      process.noAsar = previousNoAsar;
    } finally {
      releaseQueue();
    }
  }
}
