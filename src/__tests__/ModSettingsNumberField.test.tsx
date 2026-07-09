import { ModSettingsContextProvider } from 'renderer/react/settings/ModSettingsContext';
import ModSettingsNumberField from 'renderer/react/settings/ModSettingsNumberField';
import { fireEvent, render, screen } from '@testing-library/react';

describe('ModSettingsNumberField', () => {
  it('does not persist a partially parsed value from invalid input', () => {
    const onChange = jest.fn();
    render(
      <ModSettingsContextProvider>
        <ModSettingsNumberField
          field={
            {
              defaultValue: 0,
              id: 'amount',
              name: 'Amount',
              type: 'number',
            } as never
          }
          mod={{ config: { amount: 0 } } as never}
          onChange={onChange}
        />
      </ModSettingsContextProvider>,
    );

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '1a2' },
    });

    expect(onChange).not.toHaveBeenCalled();
  });
});
