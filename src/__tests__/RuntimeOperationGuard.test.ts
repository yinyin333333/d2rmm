import { RuntimeOperationGuard } from '../main/worker/RuntimeOperationGuard';

describe('RuntimeOperationGuard', () => {
  it('does not let a released stale lease clear a newer owner', () => {
    const guard = new RuntimeOperationGuard();
    const firstLease = guard.acquire('installMods');

    expect(firstLease.release()).toBe(true);

    const secondLease = guard.acquire('readD2SData');
    expect(firstLease.release()).toBe(false);
    expect(guard.getActiveOperation()).toBe('readD2SData');
    expect(() => guard.acquire('writeSaveFile')).toThrow(
      'Cannot start writeSaveFile while readD2SData is still running.',
    );

    expect(secondLease.release()).toBe(true);
    expect(guard.getActiveOperation()).toBeNull();
  });
});
