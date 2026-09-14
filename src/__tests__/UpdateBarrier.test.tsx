import { flushUpdateState } from 'renderer/UpdateBarrier';
import useSavedState from 'renderer/react/hooks/useSavedState';
import { render } from '@testing-library/react';

function Preferences(): JSX.Element {
  useSavedState('update-test-preference', 'saved');
  return <span>preferences</span>;
}
test('a storage write failure blocks update preparation', async () => {
  render(<Preferences />);
  const write = jest
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new Error('Storage quota failure');
    });
  try {
    await expect(flushUpdateState()).rejects.toThrow('Storage quota failure');
  } finally {
    write.mockRestore();
  }
});
