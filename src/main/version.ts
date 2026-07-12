const packageManifest = require('../../release/app/package.json');

export { compareVersions, getVersionParts } from '../shared/version';

/**
 * The version of the application as a string.
 */
export const CURRENT_VERSION: string = packageManifest.version;
