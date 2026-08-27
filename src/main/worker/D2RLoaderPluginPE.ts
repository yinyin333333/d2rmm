const IMAGE_FILE_MACHINE_AMD64 = 0x8664;
const PE32_PLUS_MAGIC = 0x20b;
const RT_RCDATA = 10;
const PLUGIN_MANIFEST_RESOURCE_ID = 1001;
const PLUGIN_CONFIG_RESOURCE_ID = 1002;
const MAX_EXPORT_NAMES = 8192;
const MAX_RESOURCE_ENTRIES = 8192;
const MAX_RESOURCE_BYTES = 4 * 1024 * 1024;
const MAX_STRING_BYTES = 4096;

export const D2R_LOADER_REQUIRED_PLUGIN_EXPORTS = [
  'D2RLoaderGetPluginInfo',
  'D2RLoaderLoadPlugin',
] as const;

export type D2RLoaderPluginInfo = {
  apiVersion: number;
  author: string;
  description: string;
  flags: number | null;
  id: string;
  infoSize: number;
  name: string;
  version: string;
};

export type D2RLoaderPluginPEInspection = {
  embeddedConfig: string | null;
  exports: ReadonlySet<string>;
  hasRequiredExports: boolean;
  manifestApiVersion: number | null;
  pluginInfo: D2RLoaderPluginInfo | null;
  referencedConfigFileNames: ReadonlySet<string>;
};

type PESection = {
  rawOffset: number;
  rawSize: number;
  virtualAddress: number;
  virtualSize: number;
};

type ParsedPE = {
  dataDirectoriesOffset: number;
  imageBase: number;
  optionalHeaderSize: number;
  optionalHeaderOffset: number;
  sections: PESection[];
};

function assertRange(buffer: Buffer, offset: number, length: number): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > buffer.length
  ) {
    throw new Error('PE field is outside the file');
  }
}

function readUInt16(buffer: Buffer, offset: number): number {
  assertRange(buffer, offset, 2);
  return buffer.readUInt16LE(offset);
}

function readUInt32(buffer: Buffer, offset: number): number {
  assertRange(buffer, offset, 4);
  return buffer.readUInt32LE(offset);
}

function readInt32(buffer: Buffer, offset: number): number {
  assertRange(buffer, offset, 4);
  return buffer.readInt32LE(offset);
}

function readUInt64Number(buffer: Buffer, offset: number): number {
  assertRange(buffer, offset, 8);
  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('PE pointer cannot be represented safely');
  }
  return Number(value);
}

function parsePE(buffer: Buffer): ParsedPE {
  assertRange(buffer, 0, 0x40);
  if (buffer.readUInt16LE(0) !== 0x5a4d) {
    throw new Error('Not a DOS executable');
  }

  const peOffset = readUInt32(buffer, 0x3c);
  assertRange(buffer, peOffset, 24);
  if (buffer.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new Error('Not a PE image');
  }
  if (readUInt16(buffer, peOffset + 4) !== IMAGE_FILE_MACHINE_AMD64) {
    throw new Error('D2RLoader plugins must be x64 PE images');
  }

  const sectionCount = readUInt16(buffer, peOffset + 6);
  if (sectionCount < 1 || sectionCount > 96) {
    throw new Error('Invalid PE section count');
  }
  const optionalHeaderSize = readUInt16(buffer, peOffset + 20);
  const optionalHeaderOffset = peOffset + 24;
  assertRange(buffer, optionalHeaderOffset, optionalHeaderSize);
  if (optionalHeaderSize < 120) {
    throw new Error('Truncated PE optional header');
  }
  if (readUInt16(buffer, optionalHeaderOffset) !== PE32_PLUS_MAGIC) {
    throw new Error('D2RLoader plugins must use PE32+');
  }

  const sectionTableOffset = optionalHeaderOffset + optionalHeaderSize;
  assertRange(buffer, sectionTableOffset, sectionCount * 40);
  const sections: PESection[] = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionTableOffset + index * 40;
    const section = {
      rawOffset: readUInt32(buffer, offset + 20),
      rawSize: readUInt32(buffer, offset + 16),
      virtualAddress: readUInt32(buffer, offset + 12),
      virtualSize: readUInt32(buffer, offset + 8),
    };
    if (section.rawSize > 0) {
      assertRange(buffer, section.rawOffset, section.rawSize);
    }
    sections.push(section);
  }

  return {
    dataDirectoriesOffset: optionalHeaderOffset + 112,
    imageBase: readUInt64Number(buffer, optionalHeaderOffset + 24),
    optionalHeaderOffset,
    optionalHeaderSize,
    sections,
  };
}

function rvaToOffset(
  buffer: Buffer,
  pe: ParsedPE,
  rva: number,
  length: number,
): number {
  for (const section of pe.sections) {
    const delta = rva - section.virtualAddress;
    const mappedSize = Math.max(section.virtualSize, section.rawSize);
    if (
      delta >= 0 &&
      delta + length <= mappedSize &&
      delta + length <= section.rawSize
    ) {
      const offset = section.rawOffset + delta;
      assertRange(buffer, offset, length);
      return offset;
    }
  }
  throw new Error('PE RVA is not backed by file data');
}

function readCStringAtOffset(buffer: Buffer, offset: number): string {
  assertRange(buffer, offset, 1);
  const endLimit = Math.min(buffer.length, offset + MAX_STRING_BYTES);
  let end = offset;
  while (end < endLimit && buffer[end] !== 0) {
    end += 1;
  }
  if (end === endLimit) {
    throw new Error('Unterminated PE string');
  }
  const value = buffer.toString('utf8', offset, end);
  if (value.includes('\ufffd')) {
    throw new Error('Invalid UTF-8 PE string');
  }
  return value;
}

function readCStringRva(buffer: Buffer, pe: ParsedPE, rva: number): string {
  return readCStringAtOffset(buffer, rvaToOffset(buffer, pe, rva, 1));
}

function getDataDirectory(
  buffer: Buffer,
  pe: ParsedPE,
  index: number,
): { rva: number; size: number } | null {
  const numberOfDirectories = readUInt32(buffer, pe.optionalHeaderOffset + 108);
  const entryOffset = pe.dataDirectoriesOffset + index * 8;
  if (
    index >= numberOfDirectories ||
    entryOffset + 8 > pe.optionalHeaderOffset + pe.optionalHeaderSize
  ) {
    return null;
  }
  const rva = readUInt32(buffer, entryOffset);
  const size = readUInt32(buffer, entryOffset + 4);
  return rva === 0 || size === 0 ? null : { rva, size };
}

function parseExports(
  buffer: Buffer,
  pe: ParsedPE,
): { exports: Set<string>; functionRvas: Map<string, number> } {
  const exports = new Set<string>();
  const functionRvas = new Map<string, number>();
  const directory = getDataDirectory(buffer, pe, 0);
  if (!directory) {
    return { exports, functionRvas };
  }

  const offset = rvaToOffset(buffer, pe, directory.rva, 40);
  const functionCount = readUInt32(buffer, offset + 20);
  const nameCount = readUInt32(buffer, offset + 24);
  if (nameCount > MAX_EXPORT_NAMES || nameCount > functionCount) {
    throw new Error('Invalid PE export count');
  }
  const functionsRva = readUInt32(buffer, offset + 28);
  const namesRva = readUInt32(buffer, offset + 32);
  const ordinalsRva = readUInt32(buffer, offset + 36);
  const functionsOffset = rvaToOffset(
    buffer,
    pe,
    functionsRva,
    functionCount * 4,
  );
  const namesOffset = rvaToOffset(buffer, pe, namesRva, nameCount * 4);
  const ordinalsOffset = rvaToOffset(buffer, pe, ordinalsRva, nameCount * 2);

  for (let index = 0; index < nameCount; index += 1) {
    const name = readCStringRva(
      buffer,
      pe,
      readUInt32(buffer, namesOffset + index * 4),
    );
    const ordinal = readUInt16(buffer, ordinalsOffset + index * 2);
    if (ordinal >= functionCount) {
      throw new Error('Invalid PE export ordinal');
    }
    exports.add(name);
    functionRvas.set(name, readUInt32(buffer, functionsOffset + ordinal * 4));
  }
  return { exports, functionRvas };
}

function resolvePluginInfoRva(
  buffer: Buffer,
  pe: ParsedPE,
  initialFunctionRva: number,
): number | null {
  let functionRva = initialFunctionRva;
  for (let hop = 0; hop < 4; hop += 1) {
    let offset = rvaToOffset(buffer, pe, functionRva, 8);
    if (
      buffer[offset] === 0xf3 &&
      buffer[offset + 1] === 0x0f &&
      buffer[offset + 2] === 0x1e &&
      buffer[offset + 3] === 0xfa
    ) {
      offset += 4;
      functionRva += 4;
    }
    if (buffer[offset] === 0xe9) {
      functionRva = functionRva + 5 + readInt32(buffer, offset + 1);
      continue;
    }
    if (
      buffer[offset] === 0x48 &&
      buffer[offset + 1] === 0x8d &&
      buffer[offset + 2] === 0x05
    ) {
      return functionRva + 7 + readInt32(buffer, offset + 3);
    }
    return null;
  }
  return null;
}

function parsePluginInfo(
  buffer: Buffer,
  pe: ParsedPE,
  functionRva: number | undefined,
): D2RLoaderPluginInfo | null {
  if (functionRva === undefined) {
    return null;
  }
  const infoRva = resolvePluginInfoRva(buffer, pe, functionRva);
  if (infoRva === null) {
    return null;
  }
  const offset = rvaToOffset(buffer, pe, infoRva, 48);
  const infoSize = readUInt32(buffer, offset);
  const apiVersion = readUInt32(buffer, offset + 4);
  if (infoSize < 48 || infoSize > 256 || apiVersion < 1 || apiVersion > 32) {
    return null;
  }
  rvaToOffset(buffer, pe, infoRva, infoSize);

  const readPointerString = (fieldOffset: number): string => {
    const virtualAddress = readUInt64Number(buffer, offset + fieldOffset);
    const rva = virtualAddress - pe.imageBase;
    if (!Number.isSafeInteger(rva) || rva <= 0) {
      throw new Error('Invalid PluginInfo string pointer');
    }
    return readCStringRva(buffer, pe, rva);
  };

  return {
    apiVersion,
    author: readPointerString(32),
    description: readPointerString(40),
    flags: infoSize >= 52 ? readUInt32(buffer, offset + 48) : null,
    id: readPointerString(8),
    infoSize,
    name: readPointerString(16),
    version: readPointerString(24),
  };
}

function readResource(
  buffer: Buffer,
  pe: ParsedPE,
  resourceId: number,
): Buffer | null {
  const directory = getDataDirectory(buffer, pe, 2);
  if (!directory || directory.size > MAX_RESOURCE_BYTES) {
    return null;
  }
  const baseOffset = rvaToOffset(buffer, pe, directory.rva, directory.size);
  const resourceOffset = (relativeOffset: number, length: number): number => {
    if (
      relativeOffset < 0 ||
      relativeOffset + length > directory.size ||
      relativeOffset + length > MAX_RESOURCE_BYTES
    ) {
      throw new Error('Invalid PE resource offset');
    }
    return baseOffset + relativeOffset;
  };
  const findNumericEntry = (
    directoryOffset: number,
    id: number,
  ): number | null => {
    const offset = resourceOffset(directoryOffset, 16);
    const namedCount = readUInt16(buffer, offset + 12);
    const idCount = readUInt16(buffer, offset + 14);
    const entryCount = namedCount + idCount;
    if (entryCount > MAX_RESOURCE_ENTRIES) {
      throw new Error('Invalid PE resource count');
    }
    resourceOffset(directoryOffset + 16, entryCount * 8);
    for (let index = namedCount; index < entryCount; index += 1) {
      const entryOffset = offset + 16 + index * 8;
      const entryId = readUInt32(buffer, entryOffset);
      if ((entryId & 0x80000000) === 0 && entryId === id) {
        return readUInt32(buffer, entryOffset + 4);
      }
    }
    return null;
  };
  const firstEntry = (directoryOffset: number): number | null => {
    const offset = resourceOffset(directoryOffset, 16);
    const entryCount =
      readUInt16(buffer, offset + 12) + readUInt16(buffer, offset + 14);
    if (entryCount < 1 || entryCount > MAX_RESOURCE_ENTRIES) {
      return null;
    }
    resourceOffset(directoryOffset + 16, entryCount * 8);
    return readUInt32(buffer, offset + 20);
  };
  const childDirectory = (entry: number | null): number | null =>
    entry !== null && (entry & 0x80000000) !== 0 ? entry & 0x7fffffff : null;

  const typeDirectory = childDirectory(findNumericEntry(0, RT_RCDATA));
  if (typeDirectory === null) {
    return null;
  }
  const nameDirectory = childDirectory(
    findNumericEntry(typeDirectory, resourceId),
  );
  if (nameDirectory === null) {
    return null;
  }
  const dataEntry = firstEntry(nameDirectory);
  if (dataEntry === null || (dataEntry & 0x80000000) !== 0) {
    return null;
  }
  const dataEntryOffset = resourceOffset(dataEntry, 16);
  const dataRva = readUInt32(buffer, dataEntryOffset);
  const dataSize = readUInt32(buffer, dataEntryOffset + 4);
  if (dataSize > MAX_RESOURCE_BYTES) {
    return null;
  }
  const dataOffset = rvaToOffset(buffer, pe, dataRva, dataSize);
  return buffer.subarray(dataOffset, dataOffset + dataSize);
}

function decodeConfigResource(resource: Buffer | null): string | null {
  if (!resource) {
    return null;
  }
  let end = resource.length;
  while (end > 0 && resource[end - 1] === 0) {
    end -= 1;
  }
  const value = resource.toString('utf8', 0, end).replace(/^\ufeff/, '');
  return value.includes('\ufffd') ? null : value;
}

function addConfigReference(value: string, results: Set<string>): void {
  const candidate = value.trim();
  if (candidate.length < 6 || candidate.length > 260) {
    return;
  }
  const normalized = candidate.replace(/\\/g, '/');
  const segments = normalized.split('/');
  const fileName = segments[segments.length - 1];
  if (!/^[^<>:"|?*/]+\.(?:jsonc?|toml)$/i.test(fileName)) {
    return;
  }
  if (
    segments.length === 1 ||
    segments.slice(0, -1).some((segment) => segment.toLowerCase() === 'config')
  ) {
    results.add(fileName.toLowerCase());
  }
}

function findReferencedConfigFileNames(buffer: Buffer): Set<string> {
  const results = new Set<string>();
  const scanAscii = (): void => {
    let start = -1;
    for (let index = 0; index <= buffer.length; index += 1) {
      const byte = index < buffer.length ? buffer[index] : 0;
      const printable = byte >= 0x20 && byte <= 0x7e;
      if (printable && start < 0) {
        start = index;
      } else if (!printable && start >= 0) {
        if (index - start >= 6 && index - start <= 260) {
          addConfigReference(buffer.toString('ascii', start, index), results);
        }
        start = -1;
      }
    }
  };
  const scanUtf16 = (parity: number): void => {
    let value = '';
    for (let index = parity; index + 1 < buffer.length; index += 2) {
      const character = buffer[index];
      const printable = character >= 0x20 && character <= 0x7e;
      if (printable && buffer[index + 1] === 0) {
        value += String.fromCharCode(character);
      } else {
        if (value.length >= 6) {
          addConfigReference(value, results);
        }
        value = '';
      }
      if (value.length > 260) {
        value = '';
      }
    }
    if (value.length >= 6) {
      addConfigReference(value, results);
    }
  };

  scanAscii();
  scanUtf16(0);
  scanUtf16(1);
  return results;
}

export function inspectD2RLoaderPluginPE(
  buffer: Buffer,
): D2RLoaderPluginPEInspection | null {
  try {
    const pe = parsePE(buffer);
    const parsedExports = parseExports(buffer, pe);
    const hasRequiredExports = D2R_LOADER_REQUIRED_PLUGIN_EXPORTS.every(
      (name) => parsedExports.exports.has(name),
    );
    const pluginInfo = hasRequiredExports
      ? parsePluginInfo(
          buffer,
          pe,
          parsedExports.functionRvas.get('D2RLoaderGetPluginInfo'),
        )
      : null;
    const manifestResource = readResource(
      buffer,
      pe,
      PLUGIN_MANIFEST_RESOURCE_ID,
    );

    return {
      embeddedConfig: decodeConfigResource(
        readResource(buffer, pe, PLUGIN_CONFIG_RESOURCE_ID),
      ),
      exports: parsedExports.exports,
      hasRequiredExports,
      manifestApiVersion:
        manifestResource && manifestResource.length >= 4
          ? manifestResource.readUInt32LE(0)
          : null,
      pluginInfo,
      referencedConfigFileNames: findReferencedConfigFileNames(buffer),
    };
  } catch {
    return null;
  }
}
