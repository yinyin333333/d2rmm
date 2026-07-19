import {
  createD2RLoaderPluginEditConflictError,
  D2R_LOADER_PLUGIN_EDIT_CONFLICT_ERROR_NAME,
  isD2RLoaderPluginEditConflictError,
} from 'shared/D2RLoaderPluginEditError';
import { deserializeIPCError, serializeIPCError } from 'shared/IPC';

describe('D2RLoader plugin edit conflict errors', () => {
  it('preserves the structured conflict identity across IPC serialization', () => {
    const original = createD2RLoaderPluginEditConflictError(
      'The file changed before it could be saved.',
    );
    const serialized = serializeIPCError(original);
    const restored = deserializeIPCError(serialized);

    expect(serialized.name).toBe(
      D2R_LOADER_PLUGIN_EDIT_CONFLICT_ERROR_NAME,
    );
    expect(isD2RLoaderPluginEditConflictError(restored)).toBe(true);
    expect(restored.message).toBe(original.message);
  });

  it('does not classify an ordinary error by message text', () => {
    expect(
      isD2RLoaderPluginEditConflictError(
        new Error('The file changed before it could be saved.'),
      ),
    ).toBe(false);
  });
});
