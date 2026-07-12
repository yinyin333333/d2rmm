export type ResourceLimits = {
  maxBytes: number;
  maxDepth: number;
  maxEntries: number;
};

export type ResourceUsage = {
  bytes: number;
  entries: number;
  maxDepth: number;
};

function requireNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }
}

export class ResourceBudget {
  private bytes = 0;

  private entries = 0;

  private maxDepth = 0;

  constructor(private readonly limits: ResourceLimits) {
    requireNonNegativeSafeInteger(limits.maxBytes, 'Byte limit');
    requireNonNegativeSafeInteger(limits.maxDepth, 'Depth limit');
    requireNonNegativeSafeInteger(limits.maxEntries, 'Entry count limit');
  }

  get usage(): ResourceUsage {
    return {
      bytes: this.bytes,
      entries: this.entries,
      maxDepth: this.maxDepth,
    };
  }

  addBytes(bytes: number, name: string): void {
    requireNonNegativeSafeInteger(bytes, `Byte size for "${name}"`);
    const nextBytes = this.bytes + bytes;
    if (!Number.isSafeInteger(nextBytes) || nextBytes > this.limits.maxBytes) {
      throw new Error(
        `Resource byte limit exceeded by "${name}" (${nextBytes} > ${this.limits.maxBytes}).`,
      );
    }
    this.bytes = nextBytes;
  }

  addEntry({
    bytes,
    depth,
    name,
  }: {
    bytes: number;
    depth: number;
    name: string;
  }): void {
    requireNonNegativeSafeInteger(bytes, `Byte size for "${name}"`);
    requireNonNegativeSafeInteger(depth, `Depth for "${name}"`);

    const nextEntries = this.entries + 1;
    if (nextEntries > this.limits.maxEntries) {
      throw new Error(
        `Resource entry count limit exceeded by "${name}" (${nextEntries} > ${this.limits.maxEntries}).`,
      );
    }
    if (depth > this.limits.maxDepth) {
      throw new Error(
        `Resource depth limit exceeded by "${name}" (${depth} > ${this.limits.maxDepth}).`,
      );
    }

    const nextBytes = this.bytes + bytes;
    if (!Number.isSafeInteger(nextBytes) || nextBytes > this.limits.maxBytes) {
      throw new Error(
        `Resource byte limit exceeded by "${name}" (${nextBytes} > ${this.limits.maxBytes}).`,
      );
    }

    this.bytes = nextBytes;
    this.entries = nextEntries;
    this.maxDepth = Math.max(this.maxDepth, depth);
  }
}
