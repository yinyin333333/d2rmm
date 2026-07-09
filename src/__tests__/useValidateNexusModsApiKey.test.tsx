import type { INexusAuthState } from 'renderer/react/context/NexusModsContext';
import useValidateNexusModsApiKey from 'renderer/react/context/hooks/useValidateNexusModsApiKey';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

const mockValidateNexusApiKey = jest.fn();

jest.mock('renderer/ModUpdaterAPI', () => ({
  validateNexusApiKey: (...args: unknown[]) => mockValidateNexusApiKey(...args),
}));

jest.mock('renderer/utils/deferUntilAfterFirstPaint', () => () => jest.fn());

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function Probe(): JSX.Element {
  const [authState, setAuthState] = useState<INexusAuthState>({
    apiKey: 'old-key',
  });
  const validate = useValidateNexusModsApiKey(authState, setAuthState);
  return (
    <>
      <span>{authState.apiKey}</span>
      <button onClick={validate}>Validate</button>
      <button onClick={() => setAuthState({ apiKey: 'new-key' })}>
        Replace key
      </button>
    </>
  );
}

describe('useValidateNexusModsApiKey', () => {
  beforeEach(() => {
    mockValidateNexusApiKey.mockReset();
  });

  it('does not let an old validation response clear a newer session', async () => {
    const validation = createDeferred<{
      email: string;
      isPremium: boolean;
      isValid: boolean;
      name: string;
    }>();
    mockValidateNexusApiKey.mockReturnValue(validation.promise);
    jest.spyOn(console, 'warn').mockImplementation();
    render(<Probe />);

    fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace key' }));
    await act(async () => {
      validation.resolve({
        email: '',
        isPremium: false,
        isValid: false,
        name: '',
      });
    });

    expect(screen.queryByText('new-key')).not.toBeNull();
  });
});
