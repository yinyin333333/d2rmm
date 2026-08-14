export const D2R_LOADER_PLUGIN_EDIT_CONFLICT_ERROR_NAME =
  'D2RLoaderPluginEditConflictError';

export function createD2RLoaderPluginEditConflictError(message: string): Error {
  const error = new Error(message);
  error.name = D2R_LOADER_PLUGIN_EDIT_CONFLICT_ERROR_NAME;
  return error;
}

export function isD2RLoaderPluginEditConflictError(
  error: unknown,
): error is Error {
  return (
    error instanceof Error &&
    error.name === D2R_LOADER_PLUGIN_EDIT_CONFLICT_ERROR_NAME
  );
}
