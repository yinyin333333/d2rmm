import { InstallationRuntime } from './InstallationRuntime';

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function runModTransaction(
  runtime: InstallationRuntime,
  callback: () => Promise<void>,
): Promise<void> {
  runtime.beginModTransaction();
  const modID = runtime.mod.id;

  try {
    await callback();
    runtime.commitModTransaction();
    runtime.modsInstalled.push(modID);
  } catch (modError) {
    try {
      runtime.rollbackModTransaction();
    } catch (rollbackError) {
      throw new AggregateError(
        [asError(modError), asError(rollbackError)],
        `Mod "${modID}" failed and its transaction could not be rolled back.`,
      );
    }
    throw modError;
  }
}
