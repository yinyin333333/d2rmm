import type { INexusAuthState } from 'renderer/react/context/NexusModsContext';
import useValidateNexusModsApiKey from 'renderer/react/context/hooks/useValidateNexusModsApiKey';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

const mockValidateNexusApiKey = jest.fn();

jest.mock('renderer/ModUpdaterAPI', () => ({
  __esModule: true,
  default: {
    validateNexusApiKey: (...args: unknown[]) =>
      mockValidateNexusApiKey(...args),
  },
}));

jest.mock('renderer/utils/deferUntilAfterFirstPaint', () => ({
  __esModule: true,
  default: (callback: () => void) => {
    callback();
    return jest.fn();
  },
}));

jest.mock('shared/startupProfiler', () => ({
  startupMark: jest.fn(),
  startupMeasure: (_scope: string, _name: string, callback: () => unknown) =>
    callback(),
}));

type ValidationResult = {
  email: string;
  isPremium: boolean;
  isValid: boolean;
  name: string;
};

type Deferred = {
  promise: Promise<ValidationResult>;
  resolve: (value: ValidationResult) => void;
};

function deferred(): Deferred {
  let resolve!: (value: ValidationResult) => void;
  const promise = new Promise<ValidationResult>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

let setHarnessAuthState:
  | React.Dispatch<React.SetStateAction<INexusAuthState>>
  | undefined;
let validateHarnessKey: (() => void) | undefined;

function Harness(): JSX.Element {
  const [authState, setAuthState] = useState<INexusAuthState>({ apiKey: 'A' });
  setHarnessAuthState = setAuthState;
  validateHarnessKey = useValidateNexusModsApiKey(authState, setAuthState);
  return <output>{JSON.stringify(authState)}</output>;
}

function valid(name: string): ValidationResult {
  return {
    email: `${name}@example.test`,
    isPremium: true,
    isValid: true,
    name,
  };
}

describe('Nexus API key validation generation', () => {
  beforeEach(() => {
    setHarnessAuthState = undefined;
    validateHarnessKey = undefined;
    mockValidateNexusApiKey.mockReset();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not let a slow invalid A response sign out a valid B session', async () => {
    const validationA = deferred();
    const validationB = deferred();
    mockValidateNexusApiKey
      .mockReturnValueOnce(validationA.promise)
      .mockReturnValueOnce(validationB.promise);
    render(<Harness />);

    act(() => setHarnessAuthState?.({ apiKey: 'B' }));
    expect(mockValidateNexusApiKey.mock.calls).toEqual([['A'], ['B']]);

    await act(async () => validationB.resolve(valid('B-user')));
    await waitFor(() => expect(screen.getByText(/B-user/)).toBeTruthy());

    await act(async () =>
      validationA.resolve({ ...valid('A-user'), isValid: false }),
    );
    expect(screen.getByText(/"apiKey":"B"/)).toBeTruthy();
    expect(screen.getByText(/B-user/)).toBeTruthy();
  });

  it('does not merge slow A profile data into the current B key', async () => {
    const validationA = deferred();
    const validationB = deferred();
    mockValidateNexusApiKey
      .mockReturnValueOnce(validationA.promise)
      .mockReturnValueOnce(validationB.promise);
    render(<Harness />);

    act(() => setHarnessAuthState?.({ apiKey: 'B' }));
    await act(async () => validationB.resolve(valid('B-user')));
    await act(async () => validationA.resolve(valid('A-user')));

    expect(screen.getByText(/"apiKey":"B"/)).toBeTruthy();
    expect(screen.getByText(/B-user/)).toBeTruthy();
    expect(screen.queryByText(/A-user/)).toBeNull();
  });

  it('keeps only the latest validation result for repeated checks of one key', async () => {
    const first = deferred();
    const second = deferred();
    mockValidateNexusApiKey
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render(<Harness />);

    act(() => validateHarnessKey?.());
    await act(async () => second.resolve(valid('newest')));
    await act(async () => first.resolve(valid('stale')));

    expect(screen.getByText(/newest/)).toBeTruthy();
    expect(screen.queryByText(/stale/)).toBeNull();
  });

  it('still clears the key when the latest response is invalid', async () => {
    const validation = deferred();
    mockValidateNexusApiKey.mockReturnValueOnce(validation.promise);
    render(<Harness />);

    await act(async () =>
      validation.resolve({ ...valid('invalid'), isValid: false }),
    );

    await waitFor(() =>
      expect(screen.getByText(/"apiKey":null/)).toBeTruthy(),
    );
  });
});
