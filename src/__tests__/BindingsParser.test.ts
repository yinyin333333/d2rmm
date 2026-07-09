import { parseBinding } from '../renderer/react/BindingsParser';

describe('parseBinding', () => {
  it('returns false for membership checks against an empty list', () => {
    expect(parseBinding(['in', 'value', []] as never, {}, {})).toBe(false);
    expect(parseBinding(['in', 1, []] as never, {}, {})).toBe(false);
  });
});
