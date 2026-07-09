import {
  PreExtractedDataPathContextProvider,
  usePreExtractedDataPath,
} from 'renderer/react/context/PreExtractedDataPathContext';
import { act, render, screen } from '@testing-library/react';

let mockGamePath = 'C:\\First Game';

jest.mock('renderer/react/context/GamePathContext', () => ({
  useSanitizedGamePath: () => mockGamePath,
}));

function Probe(): JSX.Element {
  const [path, setPath] = usePreExtractedDataPath();
  return (
    <>
      <span>{path}</span>
      <button onClick={() => setPath('D:\\Custom Data')}>Customize</button>
    </>
  );
}

describe('PreExtractedDataPathContext', () => {
  beforeEach(() => {
    localStorage.clear();
    mockGamePath = 'C:\\First Game';
  });

  it('follows a changing game path until the user chooses a custom path', () => {
    const view = render(
      <PreExtractedDataPathContextProvider>
        <Probe />
      </PreExtractedDataPathContextProvider>,
    );
    expect(screen.queryByText('C:\\First Game\\data')).not.toBeNull();

    mockGamePath = 'C:\\Second Game';
    view.rerender(
      <PreExtractedDataPathContextProvider>
        <Probe />
      </PreExtractedDataPathContextProvider>,
    );
    expect(screen.queryByText('C:\\Second Game\\data')).not.toBeNull();

    act(() => screen.getByRole('button').click());
    mockGamePath = 'C:\\Third Game';
    view.rerender(
      <PreExtractedDataPathContextProvider>
        <Probe />
      </PreExtractedDataPathContextProvider>,
    );
    expect(screen.queryByText('D:\\Custom Data')).not.toBeNull();
  });
});
