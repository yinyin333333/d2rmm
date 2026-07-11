export type SaveFileOperations = {
  read(filePath: string): Promise<number[] | null>;
  remove(filePath: string): Promise<void>;
  write(filePath: string, data: number[]): Promise<void>;
};

export type PendingSaveWrite = {
  data: number[];
  filePath: string;
};

function cloneWrites(writes: Map<string, number[]>): Map<string, number[]> {
  return new Map(
    [...writes].map(([filePath, data]) => [filePath, [...data]]),
  );
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export class SaveFileTransaction {
  private pendingWrites = new Map<string, number[]>();
  private checkpoint: Map<string, number[]> | null = null;

  public beginTransaction(): void {
    if (this.checkpoint != null) {
      throw new Error('A save-file transaction is already active.');
    }
    this.checkpoint = cloneWrites(this.pendingWrites);
  }

  public commitTransaction(): void {
    if (this.checkpoint == null) {
      throw new Error('No save-file transaction is active.');
    }
    this.checkpoint = null;
  }

  public rollbackTransaction(): void {
    if (this.checkpoint == null) {
      throw new Error('No save-file transaction is active.');
    }
    this.pendingWrites = this.checkpoint;
    this.checkpoint = null;
  }

  public write(filePath: string, data: number[]): void {
    this.pendingWrites.set(filePath, [...data]);
  }

  public async read(
    filePath: string,
    readOriginal: (filePath: string) => Promise<number[] | null>,
  ): Promise<number[] | null> {
    const staged = this.pendingWrites.get(filePath);
    if (staged != null) {
      return [...staged];
    }
    const original = await readOriginal(filePath);
    return original == null ? null : [...original];
  }

  public getPendingWrites(): PendingSaveWrite[] {
    return [...this.pendingWrites].map(([filePath, data]) => ({
      data: [...data],
      filePath,
    }));
  }

  public async flush(operations: SaveFileOperations): Promise<void> {
    const pendingWrites = this.getPendingWrites();
    const originals = new Map<string, number[] | null>();

    // Capture every rollback source before the first destructive write.
    for (const { filePath } of pendingWrites) {
      const original = await operations.read(filePath);
      originals.set(filePath, original == null ? null : [...original]);
    }

    const attempted: string[] = [];
    try {
      for (const { data, filePath } of pendingWrites) {
        attempted.push(filePath);
        await operations.write(filePath, [...data]);
      }
    } catch (commitError) {
      const rollbackErrors: Error[] = [];
      for (const filePath of [...attempted].reverse()) {
        try {
          const original = originals.get(filePath);
          if (original == null) {
            await operations.remove(filePath);
          } else {
            await operations.write(filePath, [...original]);
          }
        } catch (rollbackError) {
          rollbackErrors.push(asError(rollbackError));
        }
      }

      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [asError(commitError), ...rollbackErrors],
          'Save-file commit failed and rollback was incomplete.',
        );
      }
      throw commitError;
    }

    this.pendingWrites.clear();
  }
}
