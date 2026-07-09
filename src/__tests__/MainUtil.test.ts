import path from 'path';
import { pathToFileURL } from 'url';
import { resolveHtmlPath } from '../main/util';

describe('main process URL resolution', () => {
  it('creates a valid file URL for the packaged renderer', () => {
    const rendererPath = path.resolve(__dirname, '../renderer/index.html');

    expect(resolveHtmlPath('index.html')).toBe(
      pathToFileURL(rendererPath).href,
    );
  });
});
