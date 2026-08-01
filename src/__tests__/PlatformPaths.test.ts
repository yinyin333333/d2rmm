import path from 'path';
import { fileURLToPath } from 'url';
import { getDefaultBaseSavesPath } from '../main/AppInfoAPI';
import { resolveFileHtmlPath } from '../main/util';
import { getFileManagerPathIdentity } from '../main/worker/FileManager';

jest.mock('electron', () => ({ app: {} }));
jest.mock('main/IPC', () => ({ provideAPI: jest.fn() }));

describe('platform path policies', () => {
  it('preserves the existing case-insensitive Windows FileManager identity', () => {
    expect(
      getFileManagerPathIdentity('Global\\Excel\\Foo.TXT', 'win32'),
    ).toEqual({
      filePath: 'global/excel/foo.txt',
      key: 'global/excel/foo.txt',
    });
    expect(
      getFileManagerPathIdentity('global/excel/foo.txt', 'win32').key,
    ).toBe('global/excel/foo.txt');
  });

  it('keeps case-sensitive paths distinct and preserves output casing', () => {
    const upper = getFileManagerPathIdentity('Global\\Excel\\Foo.TXT', 'linux');
    const lower = getFileManagerPathIdentity('global/excel/foo.txt', 'linux');

    expect(upper).toEqual({
      filePath: 'Global/Excel/Foo.TXT',
      key: 'Global/Excel/Foo.TXT',
    });
    expect(lower.key).not.toBe(upper.key);
  });

  it('uses the home itself when USERPROFILE is unavailable', () => {
    const home = path.resolve('fake-home', 'alice');
    expect(getDefaultBaseSavesPath(undefined, home)).toBe(
      path.resolve(home, 'Saved Games', 'Diablo II Resurrected'),
    );
  });

  it('preserves the Windows USERPROFILE preference when it exists', () => {
    const profile = path.resolve('fake-users', 'alice');
    expect(getDefaultBaseSavesPath(profile, 'ignored-home')).toBe(
      path.resolve(profile, 'Saved Games', 'Diablo II Resurrected'),
    );
  });

  it('creates an encoded file URL that round-trips special characters', () => {
    const base = path.resolve('fake renderer # 한글 %');
    const result = resolveFileHtmlPath(base, 'index # 한글 %.html');

    expect(result.startsWith('file:')).toBe(true);
    expect(result).not.toContain(' # ');
    expect(fileURLToPath(result)).toBe(
      path.resolve(base, 'index # 한글 %.html'),
    );
  });
});
