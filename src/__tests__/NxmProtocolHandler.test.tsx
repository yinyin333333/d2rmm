import { EventAPI } from 'renderer/EventAPI';
import NxmProtocolAPI from 'renderer/NxmProtocolAPI';
import { INexusAuthState } from 'renderer/react/context/NexusModsContext';
import useNxmProtocolHandler from 'renderer/react/context/hooks/useNxmProtocolHandler';
import { render } from '@testing-library/react';

jest.mock('renderer/NxmProtocolAPI', () => ({
  __esModule: true,
  default: { rendererReady: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('renderer/EventAPI', () => {
  const React = jest.requireActual('react');
  const addListener = jest.fn();
  const removeListener = jest.fn();
  return {
    EventAPI: { addListener, removeListener },
    useEventAPIListener: (
      eventID: string,
      listener: (...args: unknown[]) => void,
    ) => {
      React.useEffect(() => {
        addListener(eventID, listener);
        return () => removeListener(eventID, listener);
      }, [eventID, listener]);
    },
  };
});
jest.mock('renderer/react/context/hooks/useModInstaller', () => ({
  __esModule: true,
  default: () => jest.fn().mockResolvedValue(undefined),
}));
jest.mock('renderer/react/context/hooks/useModCollectionInstaller', () => ({
  __esModule: true,
  default: () => jest.fn().mockResolvedValue(undefined),
}));

describe('useNxmProtocolHandler readiness', () => {
  it('acknowledges readiness after both EventAPI handlers are registered', () => {
    const rendererReady = (
      NxmProtocolAPI as unknown as { rendererReady: jest.Mock }
    ).rendererReady;
    const addListener = EventAPI.addListener as jest.Mock;

    function Probe(): null {
      useNxmProtocolHandler({ apiKey: null } as unknown as INexusAuthState);
      return null;
    }

    render(<Probe />);

    expect(addListener).toHaveBeenCalledTimes(2);
    expect(addListener.mock.calls.map(([eventID]) => eventID)).toEqual([
      'nexus-mods-open-url',
      'nexus-mods-open-collection-url',
    ]);
    expect(rendererReady).toHaveBeenCalledTimes(1);
    expect(Math.max(...addListener.mock.invocationCallOrder)).toBeLessThan(
      rendererReady.mock.invocationCallOrder[0],
    );
  });
});
