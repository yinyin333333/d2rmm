export type RuntimeOperationName =
  | 'installD2RLoader'
  | 'installMods'
  | 'readD2SData'
  | 'writeSaveFile';

export type RuntimeOperationLease = {
  release: () => boolean;
};

export class RuntimeOperationBusyError extends Error {
  constructor(
    public readonly requestedOperation: RuntimeOperationName,
    public readonly activeOperation: RuntimeOperationName,
  ) {
    super(
      `Cannot start ${requestedOperation} while ${activeOperation} is still running.`,
    );
    this.name = 'RuntimeOperationBusyError';
  }
}

type ActiveLease = {
  operation: RuntimeOperationName;
  token: symbol;
};

export class RuntimeOperationGuard {
  private activeLease: ActiveLease | null = null;

  acquire(operation: RuntimeOperationName): RuntimeOperationLease {
    if (this.activeLease != null) {
      throw new RuntimeOperationBusyError(
        operation,
        this.activeLease.operation,
      );
    }

    const token = Symbol(operation);
    this.activeLease = { operation, token };

    return {
      release: () => {
        if (this.activeLease?.token !== token) {
          return false;
        }
        this.activeLease = null;
        return true;
      },
    };
  }

  getActiveOperation(): RuntimeOperationName | null {
    return this.activeLease?.operation ?? null;
  }
}
