import type { Mod } from 'bridge/BridgeAPI';
import type { ModConfigFieldColor } from 'bridge/ModConfig';
import type { ModConfigValue } from 'bridge/ModConfigValue';
import ModSettingsField from 'renderer/react/settings/ModSettingsField';
import { ModSettingsContextProvider } from 'renderer/react/settings/ModSettingsContext';
import { act, fireEvent, render, screen } from '@testing-library/react';

const mockSetModConfig = jest.fn();

jest.mock('renderer/react/context/ModsContext', () => ({
  useSetModConfig: () => mockSetModConfig,
}));

jest.mock('mui-color-input', () => ({
  MuiColorInput: ({
    onChange,
    value,
  }: {
    onChange: (value: string, colors: { rgb: string }) => void;
    value: string;
  }) => (
    <div>
      <output data-testid="color-value">{value}</output>
      <button
        onClick={() =>
          onChange('#0a141e80', { rgb: 'rgba(10, 20, 30, 0.5)' })
        }
        type="button"
      >
        Pick first color
      </button>
      <button
        onClick={() =>
          onChange('#28323cff', { rgb: 'rgba(40, 50, 60, 1)' })
        }
        type="button"
      >
        Pick latest color
      </button>
    </div>
  ),
}));

const COLOR_FIELD: ModConfigFieldColor = {
  type: 'color',
  id: 'color',
  name: 'Color',
  defaultValue: [1, 2, 3, 1],
};

function makeMod(id: string, config: ModConfigValue): Mod {
  return {
    id,
    info: {
      type: 'd2rmm',
      name: `Test ${id}`,
      config: [COLOR_FIELD],
    },
    config,
  };
}

function renderColorField(mod: Mod): JSX.Element {
  return (
    <ModSettingsContextProvider>
      <ModSettingsField field={COLOR_FIELD} mod={mod} />
    </ModSettingsContextProvider>
  );
}

describe('mod settings color autosave', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockSetModConfig.mockReset();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('merges the delayed color into the latest config snapshot', () => {
    let currentConfig: ModConfigValue = {
      color: [1, 2, 3, 1],
      enabled: false,
    };
    const writes: ModConfigValue[] = [];
    mockSetModConfig.mockImplementation(
      (
        _id: string,
        update: React.SetStateAction<ModConfigValue>,
      ): void => {
        currentConfig =
          typeof update === 'function' ? update(currentConfig) : update;
        writes.push(currentConfig);
      },
    );

    const view = render(renderColorField(makeMod('mod-a', currentConfig)));
    fireEvent.click(
      screen.getByRole('button', { name: 'Pick first color' }),
    );

    mockSetModConfig('mod-a', (config: ModConfigValue) => ({
      ...config,
      enabled: true,
    }));
    view.rerender(renderColorField(makeMod('mod-a', currentConfig)));

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(writes).toEqual([
      { color: [1, 2, 3, 1], enabled: true },
      { color: [10, 20, 30, 0.5], enabled: true },
    ]);
  });

  it('cancels the previous color timeout when a newer color is chosen', () => {
    let currentConfig: ModConfigValue = { color: [1, 2, 3, 1] };
    mockSetModConfig.mockImplementation(
      (
        _id: string,
        update: React.SetStateAction<ModConfigValue>,
      ): void => {
        currentConfig =
          typeof update === 'function' ? update(currentConfig) : update;
      },
    );
    render(renderColorField(makeMod('mod-a', currentConfig)));

    fireEvent.click(
      screen.getByRole('button', { name: 'Pick first color' }),
    );
    act(() => {
      jest.advanceTimersByTime(500);
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Pick latest color' }),
    );
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(mockSetModConfig).toHaveBeenCalledTimes(1);
    expect(currentConfig).toEqual({ color: [40, 50, 60, 1] });
  });

  it('cancels a pending color write when its callback is replaced', () => {
    const view = render(
      renderColorField(makeMod('mod-a', { color: [1, 2, 3, 1] })),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Pick first color' }),
    );

    view.rerender(
      renderColorField(makeMod('mod-b', { color: [4, 5, 6, 1] })),
    );
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(mockSetModConfig).not.toHaveBeenCalled();
  });

  it('does not run a pending color write after unmount', () => {
    const view = render(
      renderColorField(makeMod('mod-a', { color: [1, 2, 3, 1] })),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Pick first color' }),
    );

    view.unmount();
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(mockSetModConfig).not.toHaveBeenCalled();
  });

  it('reflects an external color reset in the controlled value', () => {
    const view = render(
      renderColorField(makeMod('mod-a', { color: [1, 2, 3, 1] })),
    );
    expect(screen.getByTestId('color-value').textContent).toBe('#010203ff');

    view.rerender(
      renderColorField(makeMod('mod-a', { color: [10, 20, 30, 0.5] })),
    );

    expect(screen.getByTestId('color-value').textContent).toBe('#0a141e80');
  });
});
