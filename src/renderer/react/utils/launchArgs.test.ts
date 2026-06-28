import {
  normalizeLaunchArgs,
  setSeedValue,
} from 'renderer/react/utils/launchArgs';

describe('launch args helpers', () => {
  it('omits seed when the seed value is empty', () => {
    expect(setSeedValue([], '')).toEqual([]);
    expect(setSeedValue(['-seed', '123'], '')).toEqual([]);
  });

  it('sets numeric seed values', () => {
    expect(setSeedValue([], '123')).toEqual(['-seed', '123']);
  });

  it('removes bare seed args during normalization', () => {
    expect(normalizeLaunchArgs(['-seed'])).toEqual([]);
    expect(normalizeLaunchArgs(['-w', '-seed'])).toEqual(['-w']);
  });

  it('keeps only digits from seed values', () => {
    expect(setSeedValue([], '12abc3')).toEqual(['-seed', '123']);
    expect(normalizeLaunchArgs(['-seed', '12abc3'])).toEqual(['-seed', '123']);
  });
});
