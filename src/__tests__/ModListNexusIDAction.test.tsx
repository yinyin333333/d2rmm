import type { Mod } from 'bridge/BridgeAPI';
import ModListNexusIDMenuItem from 'renderer/react/modlist/ModListNexusIDAction';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';

const mockClose = jest.fn();
const mockSetModConfigOverride = jest.fn();
const mockSetModUpdate = jest.fn();
let mockDialog: React.ReactNode = null;

jest.mock('renderer/react/context/DialogContext', () => ({
  useDialog: (dialog: React.ReactNode) => {
    mockDialog = dialog;
    return [jest.fn()];
  },
  useDialogContext: () => ({ close: mockClose, isOpen: true }),
}));

jest.mock(
  'renderer/react/context/hooks/useModConfigOverride',
  () => ({
    __esModule: true,
    default: () => [
      {
        website:
          'https://www.nexusmods.com/diablo2resurrected/mods/100',
      },
      mockSetModConfigOverride,
    ],
  }),
);

jest.mock('renderer/react/context/hooks/useModUpdate', () => ({
  __esModule: true,
  default: () => [{}, mockSetModUpdate],
}));

jest.mock('renderer/react/modlist/ModListMenuItem', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@mui/material', () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>,
  Dialog: ({
    children,
    open,
  }: {
    children: React.ReactNode;
    open: boolean;
  }) => (open ? <div>{children}</div> : null),
  DialogActions: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogContentText: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TextField: ({
    label,
    onChange,
    type,
    value,
  }: {
    label: string;
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    type: string;
    value: string;
  }) => (
    <input
      aria-label={label}
      onChange={onChange}
      type={type}
      value={value}
    />
  ),
  createSvgIcon: () => () => null,
}));

const MOD: Mod = {
  id: 'local-mod',
  info: {
    type: 'd2rmm',
    name: 'Local Mod',
    website: 'https://www.nexusmods.com/diablo2resurrected/mods/100',
  },
  config: {},
};

function renderDialog(): void {
  render(<ModListNexusIDMenuItem mod={MOD} />);
  render(<>{mockDialog}</>);
}

describe('ModListNexusIDAction update cache invalidation', () => {
  beforeEach(() => {
    mockDialog = null;
    mockClose.mockReset();
    mockSetModConfigOverride.mockReset();
    mockSetModUpdate.mockReset();
  });

  it('clears cached updates when the submitted Nexus source changes', () => {
    renderDialog();

    fireEvent.change(screen.getByRole('spinbutton'), {
      target: { value: '200' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockSetModConfigOverride).toHaveBeenCalledTimes(1);
    expect(mockSetModUpdate).toHaveBeenCalledWith(null);
  });

  it('preserves cached updates when the submitted source is unchanged', () => {
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockSetModConfigOverride).toHaveBeenCalledTimes(1);
    expect(mockSetModUpdate).not.toHaveBeenCalled();
  });

  it('preserves the existing clear behavior', () => {
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(mockSetModUpdate).toHaveBeenCalledWith(null);
  });
});
