import type { ModUpdaterDownload } from 'bridge/ModUpdaterAPI';
import {
  compareVersions as compareMainVersions,
  getVersionParts as getMainVersionParts,
} from 'main/version';
import getUpdatesFromDownloads from 'renderer/react/context/utils/getUpdatesFromDownloads';
import {
  compareVersions as compareRendererVersions,
  getVersionParts as getRendererVersionParts,
} from 'renderer/utils/version';

const comparators = [
  ['main', compareMainVersions],
  ['renderer', compareRendererVersions],
] as const;

describe.each(comparators)('%s version comparison', (_name, compare) => {
  it.each([
    ['1', '1.0.0'],
    ['1.2', '1.2.0'],
    ['1.2.3', '1.2.3.0'],
    ['v1.2.3', '1.2.3'],
    ['1.2.3+build.1', '1.2.3+build.2'],
  ])('treats supported equivalent versions %s and %s as equal', (a, b) => {
    expect(compare(a, b)).toBe(0);
    expect(compare(b, a)).toBe(0);
  });

  it.each([
    ['1.2.4', '1.2.3'],
    ['v2.0.0', '1.9.9'],
    ['1.2.3.4', '1.2.3.3'],
    ['1.2.3', '1.2.3-beta'],
    ['1.2.3-beta', '1.2.3-alpha'],
    ['1.2.3-beta.2', '1.2.3-beta.1'],
    ['1.2.3-beta.1', '1.2.3-beta'],
  ])('orders supported newer version %s before %s', (newer, older) => {
    expect(compare(newer, older)).toBeLessThan(0);
    expect(compare(older, newer)).toBeGreaterThan(0);
  });

  it.each([
    '',
    'v',
    '.1.2',
    '1.2.',
    '1..2',
    '1.x.2',
    '1.2.3beta',
    '1.2.3.4.5',
    '1.2.3-',
    '1.2.3-alpha..1',
  ])(
    'rejects invalid version %j instead of treating it as equal',
    (invalid) => {
      expect(() => compare(invalid, invalid)).toThrow(/Invalid version/);
    },
  );
});

describe('shared version caller semantics', () => {
  it('keeps the legacy three-part helper API while accepting supported syntax', () => {
    expect(getMainVersionParts('v1.2')).toEqual([1, 2, 0]);
    expect(getRendererVersionParts('1.2.3.4')).toEqual([1, 2, 3]);
  });

  it('sorts newest versions first for the update UI', () => {
    expect(['1.2.3', '1.3.0', '1.2.4'].sort(compareRendererVersions)).toEqual([
      '1.3.0',
      '1.2.4',
      '1.2.3',
    ]);
  });

  it('selects only downloads newer than the current version', () => {
    const downloads: ModUpdaterDownload[] = [
      { type: 'nexus', modID: '1', fileID: 1, version: '1.2.2' },
      { type: 'nexus', modID: '1', fileID: 2, version: '1.2.3' },
      { type: 'nexus', modID: '1', fileID: 3, version: '1.2.4-beta' },
      { type: 'nexus', modID: '1', fileID: 4, version: '1.2.4' },
    ];

    expect(
      getUpdatesFromDownloads('1.2.3', downloads).map(({ fileID }) => fileID),
    ).toEqual([3, 4]);
  });
});
