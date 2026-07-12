/* eslint import/prefer-default-export: off, import/no-mutable-exports: off */
import path from 'path';
import { pathToFileURL, URL } from 'url';

export let resolveHtmlPath: (htmlFileName: string) => string;

export function resolveFileHtmlPath(
  rendererPath: string,
  htmlFileName: string,
): string {
  return pathToFileURL(path.resolve(rendererPath, htmlFileName)).href;
}

if (process.env.NODE_ENV === 'development') {
  const port = process.env.PORT || 1212;
  resolveHtmlPath = (htmlFileName: string) => {
    const url = new URL(`http://localhost:${port}`);
    url.pathname = htmlFileName;
    return url.href;
  };
} else {
  resolveHtmlPath = (htmlFileName: string) => {
    return resolveFileHtmlPath(
      path.resolve(__dirname, '../renderer/'),
      htmlFileName,
    );
  };
}
