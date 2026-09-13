// Electron's fs virtualizes *.asar paths. Updater hashes and copies must always
// see the physical archive bytes, without toggling process.noAsar globally.
const rawFS: typeof import('fs') =
  process.versions.electron == null ? require('fs') : require('original-fs');
export const { createReadStream, createWriteStream, promises: fs } = rawFS;
