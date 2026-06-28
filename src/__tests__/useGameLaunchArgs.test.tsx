import useGameLaunchArgs from 'renderer/react/hooks/useGameLaunchArgs';
import { render } from '@testing-library/react';

let mockExtraArgs: string[] = [];
let mockIsDirectMode = false;
let mockOutputModName = 'D2RMM';

jest.mock('renderer/react/context/ExtraGameLaunchArgsContext', () => ({
  useExtraGameLaunchArgs: () => [mockExtraArgs],
}));

jest.mock('renderer/react/context/IsDirectModeContext', () => ({
  useIsDirectMode: () => [mockIsDirectMode],
}));

jest.mock('renderer/react/context/OutputModNameContext', () => ({
  useOutputModName: () => [mockOutputModName],
}));

function renderUseGameLaunchArgs(): string[] {
  let result: string[] = [];

  function Probe(): null {
    result = useGameLaunchArgs();
    return null;
  }

  render(<Probe />);
  return result;
}

describe('useGameLaunchArgs', () => {
  beforeEach(() => {
    mockExtraArgs = [];
    mockIsDirectMode = false;
    mockOutputModName = 'D2RMM';
  });

  it('does not emit empty args or bare seed args', () => {
    mockExtraArgs = ['', '  ', '-seed', '-w'];

    expect(renderUseGameLaunchArgs()).toEqual(['-mod', 'D2RMM', '-txt', '-w']);
  });

  it('emits seed only when a value is present', () => {
    mockExtraArgs = ['-seed', '123'];

    expect(renderUseGameLaunchArgs()).toEqual([
      '-mod',
      'D2RMM',
      '-txt',
      '-seed',
      '123',
    ]);
  });
});
