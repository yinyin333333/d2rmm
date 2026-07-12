import { withNoAsar } from '../main/worker/NoAsarScope';

describe('withNoAsar', () => {
  const originalNoAsar = process.noAsar;

  afterEach(() => {
    process.noAsar = originalNoAsar;
  });

  it('serializes overlapping operations and restores the previous state', async () => {
    process.noAsar = false;
    const events: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let notifyFirstEntered: () => void = () => undefined;
    const firstEntered = new Promise<void>((resolve) => {
      notifyFirstEntered = resolve;
    });

    const first = withNoAsar(async () => {
      events.push(`first:start:${String(process.noAsar)}`);
      notifyFirstEntered();
      await firstGate;
      events.push(`first:end:${String(process.noAsar)}`);
      return 'first';
    });

    await firstEntered;
    let secondEntered = false;
    const second = withNoAsar(async () => {
      secondEntered = true;
      events.push(`second:start:${String(process.noAsar)}`);
      return 'second';
    });

    await Promise.resolve();
    expect(secondEntered).toBe(false);
    expect(process.noAsar).toBe(true);

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([
      'first',
      'second',
    ]);
    expect(events).toEqual([
      'first:start:true',
      'first:end:true',
      'second:start:true',
    ]);
    expect(process.noAsar).toBe(false);
  });

  it('restores state and does not poison the queue after an error', async () => {
    process.noAsar = false;

    await expect(
      withNoAsar(async () => {
        expect(process.noAsar).toBe(true);
        throw new Error('expected failure');
      }),
    ).rejects.toThrow('expected failure');
    expect(process.noAsar).toBe(false);

    await expect(
      withNoAsar(async () => {
        expect(process.noAsar).toBe(true);
        return 'recovered';
      }),
    ).resolves.toBe('recovered');
    expect(process.noAsar).toBe(false);
  });
});
