import { createQuickJSContextWithMemoryLimit } from '../main/worker/quickjs';

describe('explicit QuickJS memory resource configuration seam', () => {
  it('sets the limit before returning a new context', () => {
    const setMemoryLimit = jest.fn();
    const context = {
      dispose: jest.fn(),
      runtime: { setMemoryLimit },
    };
    const module = { newContext: jest.fn(() => context) };

    expect(
      createQuickJSContextWithMemoryLimit(module as never, 256 * 1024),
    ).toBe(context);
    expect(setMemoryLimit).toHaveBeenCalledWith(256 * 1024);
    expect(context.dispose).not.toHaveBeenCalled();
  });

  it('disposes the new context if limit configuration fails', () => {
    const failure = new Error('synthetic limit failure');
    const context = {
      dispose: jest.fn(),
      runtime: { setMemoryLimit: jest.fn(() => { throw failure; }) },
    };
    const module = { newContext: jest.fn(() => context) };

    expect(() =>
      createQuickJSContextWithMemoryLimit(module as never, 256 * 1024),
    ).toThrow(failure);
    expect(context.dispose).toHaveBeenCalledTimes(1);
  });
});
