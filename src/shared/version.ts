type ParsedVersion = {
  core: [number, number, number, number];
  prerelease: string[];
};

const VERSION_PATTERN =
  /^v?(\d+(?:\.\d+){0,3})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/i;

export class InvalidVersionError extends Error {
  constructor(version: string, reason: string) {
    super(`Invalid version "${version}": ${reason}.`);
    this.name = 'InvalidVersionError';
  }
}

function parseNumericIdentifier(version: string, identifier: string): number {
  const value = Number(identifier);
  if (!Number.isSafeInteger(value)) {
    throw new InvalidVersionError(
      version,
      `numeric identifier "${identifier}" is outside the safe integer range`,
    );
  }
  return value;
}

function parseVersion(version: string): ParsedVersion {
  const normalized = version.trim();
  const match = VERSION_PATTERN.exec(normalized);
  if (match == null) {
    throw new InvalidVersionError(
      version,
      'expected 1-4 numeric segments with optional leading v, prerelease, and build metadata',
    );
  }

  const coreParts = match[1].split('.').map((identifier) =>
    parseNumericIdentifier(version, identifier),
  );
  const core: [number, number, number, number] = [0, 0, 0, 0];
  coreParts.forEach((value, index) => {
    core[index] = value;
  });

  const prerelease = match[2]?.split('.') ?? [];
  prerelease.forEach((identifier) => {
    if (/^\d+$/.test(identifier)) {
      parseNumericIdentifier(version, identifier);
    }
  });

  return { core, prerelease };
}

function comparePrereleaseIdentifier(a: string, b: string): number {
  const aIsNumeric = /^\d+$/.test(a);
  const bIsNumeric = /^\d+$/.test(b);
  if (aIsNumeric && bIsNumeric) {
    const aNumber = Number(a);
    const bNumber = Number(b);
    return aNumber > bNumber ? -1 : aNumber < bNumber ? 1 : 0;
  }
  if (aIsNumeric !== bIsNumeric) {
    return aIsNumeric ? 1 : -1;
  }
  return a > b ? -1 : a < b ? 1 : 0;
}

/**
 * Returns the legacy major/minor/patch tuple after validating the full version.
 */
export function getVersionParts(version: string): [number, number, number] {
  const { core } = parseVersion(version);
  return [core[0], core[1], core[2]];
}

/**
 * Compares supported versions in newest-first order for Array.sort.
 *
 * Supported syntax uses one to four numeric core segments, an optional leading
 * `v`, optional SemVer-style prerelease identifiers, and ignored build metadata.
 * Missing core segments are zero. Invalid input throws InvalidVersionError.
 */
export function compareVersions(a: string, b: string): number {
  const aVersion = parseVersion(a);
  const bVersion = parseVersion(b);

  for (let i = 0; i < aVersion.core.length; i++) {
    if (aVersion.core[i] > bVersion.core[i]) {
      return -1;
    }
    if (aVersion.core[i] < bVersion.core[i]) {
      return 1;
    }
  }

  if (aVersion.prerelease.length === 0) {
    return bVersion.prerelease.length === 0 ? 0 : -1;
  }
  if (bVersion.prerelease.length === 0) {
    return 1;
  }

  const identifierCount = Math.min(
    aVersion.prerelease.length,
    bVersion.prerelease.length,
  );
  for (let i = 0; i < identifierCount; i++) {
    const comparison = comparePrereleaseIdentifier(
      aVersion.prerelease[i],
      bVersion.prerelease[i],
    );
    if (comparison !== 0) {
      return comparison;
    }
  }

  return aVersion.prerelease.length > bVersion.prerelease.length
    ? -1
    : aVersion.prerelease.length < bVersion.prerelease.length
      ? 1
      : 0;
}
