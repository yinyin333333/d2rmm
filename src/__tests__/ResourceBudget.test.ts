import { ResourceBudget } from '../main/worker/ResourceBudget';

describe('ResourceBudget', () => {
  it('tracks exact count, bytes, and depth for small normal input', () => {
    const budget = new ResourceBudget({
      maxBytes: 100,
      maxDepth: 4,
      maxEntries: 3,
    });

    budget.addEntry({ bytes: 25, depth: 1, name: 'first' });
    budget.addEntry({ bytes: 50, depth: 4, name: 'second' });

    expect(budget.usage).toEqual({
      bytes: 75,
      entries: 2,
      maxDepth: 4,
    });
  });

  it.each([
    ['bytes', { bytes: 101, depth: 1, name: 'large' }, /byte limit/i],
    ['count', { bytes: 0, depth: 1, name: 'third' }, /entry count/i],
    ['depth', { bytes: 0, depth: 5, name: 'deep' }, /depth limit/i],
  ] as const)('rejects input beyond the %s bound', (_kind, entry, message) => {
    const budget = new ResourceBudget({
      maxBytes: 100,
      maxDepth: 4,
      maxEntries: 2,
    });
    if (_kind === 'count') {
      budget.addEntry({ bytes: 0, depth: 1, name: 'first' });
      budget.addEntry({ bytes: 0, depth: 1, name: 'second' });
    }

    expect(() => budget.addEntry(entry)).toThrow(message);
  });
});
