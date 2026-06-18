import '@testing-library/jest-dom';
import App from '../renderer/react/App';
import { fireEvent, render, screen } from '@testing-library/react';

jest.mock('renderer/IPC', () => ({
  consumeAPI: () =>
    new Proxy(
      {},
      {
        get: (_target, api) => async () => {
          if (api === 'getGamePath') {
            return 'C:\\Diablo II Resurrected';
          }
          if (api === 'getIsRegistered') {
            return true;
          }
          return [];
        },
      },
    ),
}));

jest.mock('renderer/AppInfoAPI', () => ({
  getAppPath: () => 'C:\\D2RMM',
  getBaseSavesPath: () => 'C:\\Users\\test\\Saved Games\\Diablo II Resurrected',
}));

describe('App', () => {
  it('should render', () => {
    expect(render(<App />)).toBeTruthy();
  });

  it('should open lazy settings and logs tabs', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(await screen.findByText('D2RLoader')).toBeInTheDocument();

    const logsTab = screen.getByRole('tab', { name: 'Logs' });
    fireEvent.click(logsTab);
    expect(logsTab).toHaveAttribute('aria-selected', 'true');
  });
});
