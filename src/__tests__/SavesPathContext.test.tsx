import {
  SavesPathContextProvider,
  useDefaultSavesPath,
  useFinalSavesPath,
} from 'renderer/react/context/SavesPathContext';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

jest.mock('renderer/AppInfoAPI', () => ({
  getBaseSavesPath: () => 'C:\\FakeSaves',
}));

jest.mock('renderer/react/context/OutputModNameContext', () => ({
  useOutputModName: () => ['D2RMM'],
}));

function Probe(): JSX.Element {
  const defaultPath = useDefaultSavesPath();
  const finalPath = useFinalSavesPath();
  return (
    <>
      <span data-testid="default-save-path">{defaultPath}</span>
      <span data-testid="final-save-path">{finalPath}</span>
    </>
  );
}

describe('SavesPathContext', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('ignores the legacy Direct Mode value and uses the mod save folder', () => {
    localStorage.setItem('direct-mod', 'true');

    render(
      <SavesPathContextProvider>
        <Probe />
      </SavesPathContextProvider>,
    );

    const expectedPath = 'C:\\FakeSaves\\mods\\D2RMM';
    expect(screen.getByTestId('default-save-path')).toHaveTextContent(
      expectedPath,
    );
    expect(screen.getByTestId('final-save-path')).toHaveTextContent(
      expectedPath,
    );
  });
});
