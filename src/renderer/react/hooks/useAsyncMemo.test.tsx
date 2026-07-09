import { useAsyncMemo } from 'renderer/react/hooks/useAsyncMemo';
import { act, render, screen } from '@testing-library/react';

type Deferred<T> = {
  promise: Promise<T>;
  reject: (error: Error) => void;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let reject: (error: Error) => void = () => {};
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function Probe({ getValue }: { getValue: () => Promise<string> }): JSX.Element {
  const value = useAsyncMemo(getValue);
  return <div>{value ?? 'pending'}</div>;
}

describe('useAsyncMemo', () => {
  it('ignores results from replaced requests', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const { rerender } = render(<Probe getValue={() => first.promise} />);

    rerender(<Probe getValue={() => second.promise} />);

    await act(async () => {
      first.resolve('stale');
    });
    expect(screen.queryByText('pending')).not.toBeNull();

    await act(async () => {
      second.resolve('current');
    });
    expect(screen.queryByText('current')).not.toBeNull();
  });

  it('ignores failures from unmounted requests', async () => {
    const deferred = createDeferred<string>();
    const consoleError = jest.spyOn(console, 'error').mockImplementation();
    const { unmount } = render(<Probe getValue={() => deferred.promise} />);

    unmount();
    await act(async () => {
      deferred.reject(new Error('stale request'));
    });

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
