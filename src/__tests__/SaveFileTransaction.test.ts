import { SaveFileTransaction } from '../main/worker/SaveFileTransaction';

function createOperations(initial: Record<string, number[]>) {
  const files = new Map(
    Object.entries(initial).map(([filePath, data]) => [filePath, [...data]]),
  );
  const reads: string[] = [];
  const writes: string[] = [];
  const removes: string[] = [];
  let failWrite: string | null = null;
  let failWriteAfterMutation: string | null = null;
  let failRollback: string | null = null;

  return {
    files,
    reads,
    removes,
    writes,
    setFailRollback(filePath: string | null) {
      failRollback = filePath;
    },
    setFailWrite(filePath: string | null) {
      failWrite = filePath;
    },
    setFailWriteAfterMutation(filePath: string | null) {
      failWriteAfterMutation = filePath;
    },
    operations: {
      read: async (filePath: string): Promise<number[] | null> => {
        reads.push(filePath);
        return files.has(filePath) ? [...files.get(filePath)!] : null;
      },
      remove: async (filePath: string): Promise<void> => {
        removes.push(filePath);
        if (filePath === failRollback) {
          throw new Error(`rollback remove failed: ${filePath}`);
        }
        files.delete(filePath);
      },
      write: async (filePath: string, data: number[]): Promise<void> => {
        writes.push(filePath);
        if (filePath === failWrite) {
          failWrite = null;
          throw new Error(`write failed: ${filePath}`);
        }
        if (filePath === failRollback && writes.filter((x) => x === filePath).length > 1) {
          throw new Error(`rollback write failed: ${filePath}`);
        }
        files.set(filePath, [...data]);
        if (filePath === failWriteAfterMutation) {
          failWriteAfterMutation = null;
          throw new Error(`write failed after mutation: ${filePath}`);
        }
      },
    },
  };
}

describe('SaveFileTransaction', () => {
  it('provides a staged read overlay and rolls back a failed mod', async () => {
    const saves = new SaveFileTransaction();
    const diskRead = jest.fn().mockResolvedValue([1, 2, 3]);

    saves.beginTransaction();
    saves.write('Hero.d2s', [9, 8, 7]);
    await expect(saves.read('Hero.d2s', diskRead)).resolves.toEqual([9, 8, 7]);
    saves.rollbackTransaction();

    await expect(saves.read('Hero.d2s', diskRead)).resolves.toEqual([1, 2, 3]);
    expect(diskRead).toHaveBeenCalledTimes(1);
    expect(saves.getPendingWrites()).toEqual([]);
  });

  it('commits only the successful mod staging', () => {
    const saves = new SaveFileTransaction();

    saves.beginTransaction();
    saves.write('A.d2s', [1]);
    saves.commitTransaction();
    saves.beginTransaction();
    saves.write('A.d2s', [2]);
    saves.write('B.d2i', [3]);
    saves.rollbackTransaction();

    expect(saves.getPendingWrites()).toEqual([
      { data: [1], filePath: 'A.d2s' },
    ]);
  });

  it('reads every original before the first disk write and clears on success', async () => {
    const saves = new SaveFileTransaction();
    const fake = createOperations({ 'A.d2s': [1], 'B.d2i': [2] });
    saves.write('A.d2s', [10]);
    saves.write('B.d2i', [20]);

    await saves.flush(fake.operations);

    expect(fake.reads).toEqual(['A.d2s', 'B.d2i']);
    expect(fake.writes).toEqual(['A.d2s', 'B.d2i']);
    expect(fake.files.get('A.d2s')).toEqual([10]);
    expect(fake.files.get('B.d2i')).toEqual([20]);
    expect(saves.getPendingWrites()).toEqual([]);
  });

  it('restores written originals and deletes newly created saves after failure', async () => {
    const saves = new SaveFileTransaction();
    const fake = createOperations({ 'A.d2s': [1] });
    saves.write('A.d2s', [10]);
    saves.write('New.d2i', [20]);
    saves.write('C.d2s', [30]);
    fake.setFailWrite('C.d2s');

    await expect(saves.flush(fake.operations)).rejects.toThrow(
      'write failed: C.d2s',
    );

    expect(fake.files.get('A.d2s')).toEqual([1]);
    expect(fake.files.has('New.d2i')).toBe(false);
    expect(fake.removes).toEqual(['C.d2s', 'New.d2i']);
    expect(saves.getPendingWrites()).toHaveLength(3);
  });

  it('restores the current file when its write mutates disk before failing', async () => {
    const saves = new SaveFileTransaction();
    const fake = createOperations({ 'A.d2s': [1], 'B.d2s': [2] });
    saves.write('A.d2s', [10]);
    saves.write('B.d2s', [20]);
    fake.setFailWriteAfterMutation('B.d2s');

    await expect(saves.flush(fake.operations)).rejects.toThrow(
      'write failed after mutation: B.d2s',
    );

    expect(fake.files.get('A.d2s')).toEqual([1]);
    expect(fake.files.get('B.d2s')).toEqual([2]);
    expect(saves.getPendingWrites()).toHaveLength(2);
  });

  it('reports both commit and rollback failures without clearing staging', async () => {
    const saves = new SaveFileTransaction();
    const fake = createOperations({ 'A.d2s': [1] });
    saves.write('A.d2s', [10]);
    saves.write('B.d2s', [20]);
    fake.setFailWrite('B.d2s');
    fake.setFailRollback('A.d2s');

    await expect(saves.flush(fake.operations)).rejects.toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({ message: 'write failed: B.d2s' }),
        expect.objectContaining({ message: 'rollback write failed: A.d2s' }),
      ]),
    });
    expect(saves.getPendingWrites()).toHaveLength(2);
  });
});
