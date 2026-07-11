export type PendingRequestTimers = {
  clearTimeout: (timeout: ReturnType<typeof setTimeout>) => void;
  setTimeout: (
    callback: () => void,
    timeoutMs: number,
  ) => ReturnType<typeof setTimeout>;
};

export type PendingRequest<TDestination, TResult> = {
  destination: TDestination;
  id: string;
  reject: (error: Error) => void;
  resolve: (result: TResult) => void;
  timeoutError?: () => Error;
  timeoutMs?: number;
};

type PendingRequestEntry<TDestination, TResult> = PendingRequest<
  TDestination,
  TResult
> & {
  timeout: ReturnType<typeof setTimeout> | null;
};

const DEFAULT_TIMERS: PendingRequestTimers = {
  clearTimeout: (timeout) => clearTimeout(timeout),
  setTimeout: (callback, timeoutMs) => setTimeout(callback, timeoutMs),
};

export class PendingRequestRegistry<TDestination, TResult> {
  private readonly requests = new Map<
    string,
    PendingRequestEntry<TDestination, TResult>
  >();

  constructor(private readonly timers = DEFAULT_TIMERS) {}

  get size(): number {
    return this.requests.size;
  }

  add(request: PendingRequest<TDestination, TResult>): void {
    if (this.requests.has(request.id)) {
      throw new Error(`Duplicate pending IPC request id: ${request.id}`);
    }
    if (
      request.timeoutMs != null &&
      (!Number.isFinite(request.timeoutMs) || request.timeoutMs < 0)
    ) {
      throw new Error(`Invalid IPC request timeout: ${request.timeoutMs}`);
    }

    const entry: PendingRequestEntry<TDestination, TResult> = {
      ...request,
      timeout: null,
    };
    this.requests.set(request.id, entry);
    if (request.timeoutMs != null) {
      entry.timeout = this.timers.setTimeout(() => {
        const error = request.timeoutError?.() ?? new Error();
        error.name = 'IPCRequestTimeoutError';
        if (error.message === '') {
          error.message = `IPC request ${request.id} timed out after ${request.timeoutMs}ms.`;
        }
        this.reject(request.id, error);
      }, request.timeoutMs);
    }
  }

  getDestination(id: string): TDestination | undefined {
    return this.requests.get(id)?.destination;
  }

  resolve(id: string, result: TResult): boolean {
    const request = this.take(id);
    if (request == null) {
      return false;
    }
    request.resolve(result);
    return true;
  }

  reject(id: string, error: Error): boolean {
    const request = this.take(id);
    if (request == null) {
      return false;
    }
    request.reject(error);
    return true;
  }

  rejectDestination(destination: TDestination, error: Error): number {
    const ids = Array.from(this.requests.entries())
      .filter(([, request]) => Object.is(request.destination, destination))
      .map(([id]) => id);
    ids.forEach((id) => this.reject(id, error));
    return ids.length;
  }

  rejectAll(error: Error): number {
    const ids = Array.from(this.requests.keys());
    ids.forEach((id) => this.reject(id, error));
    return ids.length;
  }

  private take(
    id: string,
  ): PendingRequestEntry<TDestination, TResult> | undefined {
    const request = this.requests.get(id);
    if (request == null) {
      return undefined;
    }
    this.requests.delete(id);
    if (request.timeout != null) {
      this.timers.clearTimeout(request.timeout);
    }
    return request;
  }
}
