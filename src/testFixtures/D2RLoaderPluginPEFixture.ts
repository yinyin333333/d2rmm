export type TestPluginPEOptions = {
  configReference?: string;
  embeddedConfig?: string;
  includePluginInfo?: boolean;
};

function writeSectionHeader(
  buffer: Buffer,
  offset: number,
  name: string,
  virtualAddress: number,
  rawOffset: number,
  characteristics: number,
): void {
  buffer.write(name, offset, 8, 'ascii');
  buffer.writeUInt32LE(0x200, offset + 8);
  buffer.writeUInt32LE(virtualAddress, offset + 12);
  buffer.writeUInt32LE(0x200, offset + 16);
  buffer.writeUInt32LE(rawOffset, offset + 20);
  buffer.writeUInt32LE(characteristics, offset + 36);
}

function writeCString(buffer: Buffer, offset: number, value: string): void {
  buffer.write(`${value}\0`, offset, 'utf8');
}

export function createTestD2RLoaderPluginPE(
  options: TestPluginPEOptions = {},
): Buffer {
  const imageBase = 0x180000000;
  const buffer = Buffer.alloc(0xc00);
  buffer.writeUInt16LE(0x5a4d, 0);
  buffer.writeUInt32LE(0x80, 0x3c);
  buffer.write('PE\0\0', 0x80, 'ascii');
  buffer.writeUInt16LE(0x8664, 0x84);
  buffer.writeUInt16LE(3, 0x86);
  buffer.writeUInt16LE(0xf0, 0x94);
  buffer.writeUInt16LE(0x2022, 0x96);

  const optional = 0x98;
  buffer.writeUInt16LE(0x20b, optional);
  buffer.writeUInt32LE(0x1000, optional + 16);
  buffer.writeUInt32LE(0x1000, optional + 20);
  buffer.writeBigUInt64LE(BigInt(imageBase), optional + 24);
  buffer.writeUInt32LE(0x1000, optional + 32);
  buffer.writeUInt32LE(0x200, optional + 36);
  buffer.writeUInt32LE(0x4000, optional + 56);
  buffer.writeUInt32LE(0x200, optional + 60);
  buffer.writeUInt32LE(16, optional + 108);
  buffer.writeUInt32LE(0x2000, optional + 112);
  buffer.writeUInt32LE(0x200, optional + 116);
  buffer.writeUInt32LE(0x3000, optional + 128);
  buffer.writeUInt32LE(0x200, optional + 132);

  writeSectionHeader(buffer, 0x188, '.text', 0x1000, 0x200, 0x60000020);
  writeSectionHeader(buffer, 0x1b0, '.rdata', 0x2000, 0x400, 0x40000040);
  writeSectionHeader(buffer, 0x1d8, '.rsrc', 0x3000, 0x800, 0x40000040);

  buffer[0x200] = 0x48;
  buffer[0x201] = 0x8d;
  buffer[0x202] = 0x05;
  buffer.writeInt32LE(0x2100 - (0x1000 + 7), 0x203);
  buffer[0x207] = 0xc3;
  if (options.includePluginInfo === false) {
    buffer.fill(0, 0x200, 0x208);
    buffer[0x200] = 0xc3;
  }
  buffer[0x220] = 0xb0;
  buffer[0x221] = 0x01;
  buffer[0x222] = 0xc3;

  const exports = 0x400;
  buffer.writeUInt32LE(1, exports + 16);
  buffer.writeUInt32LE(2, exports + 20);
  buffer.writeUInt32LE(2, exports + 24);
  buffer.writeUInt32LE(0x2040, exports + 28);
  buffer.writeUInt32LE(0x2048, exports + 32);
  buffer.writeUInt32LE(0x2050, exports + 36);
  buffer.writeUInt32LE(0x1000, 0x440);
  buffer.writeUInt32LE(0x1020, 0x444);
  buffer.writeUInt32LE(0x2060, 0x448);
  buffer.writeUInt32LE(0x2080, 0x44c);
  buffer.writeUInt16LE(0, 0x450);
  buffer.writeUInt16LE(1, 0x452);
  writeCString(buffer, 0x460, 'D2RLoaderGetPluginInfo');
  writeCString(buffer, 0x480, 'D2RLoaderLoadPlugin');

  const pluginInfo = 0x500;
  buffer.writeUInt32LE(72, pluginInfo);
  buffer.writeUInt32LE(3, pluginInfo + 4);
  for (const [fieldOffset, rva] of [
    [8, 0x2160],
    [16, 0x2180],
    [24, 0x21a0],
    [32, 0x21b0],
    [40, 0x21c0],
  ]) {
    buffer.writeBigUInt64LE(BigInt(imageBase + rva), pluginInfo + fieldOffset);
  }
  buffer.writeUInt32LE(5, pluginInfo + 48);
  writeCString(buffer, 0x560, 'test-plugin');
  writeCString(buffer, 0x580, 'Test Plugin');
  writeCString(buffer, 0x5a0, '1.2.3');
  writeCString(buffer, 0x5b0, 'D2RMM');
  writeCString(buffer, 0x5c0, 'Synthetic plugin fixture');
  if (options.configReference) {
    writeCString(buffer, 0x700, options.configReference);
  }

  const resource = 0x800;
  buffer.writeUInt16LE(1, resource + 14);
  buffer.writeUInt32LE(10, resource + 16);
  buffer.writeUInt32LE(0x80000020, resource + 20);
  buffer.writeUInt16LE(2, resource + 0x20 + 14);
  buffer.writeUInt32LE(1001, resource + 0x30);
  buffer.writeUInt32LE(0x80000050, resource + 0x34);
  buffer.writeUInt32LE(1002, resource + 0x38);
  buffer.writeUInt32LE(0x80000068, resource + 0x3c);
  buffer.writeUInt16LE(1, resource + 0x50 + 14);
  buffer.writeUInt32LE(1033, resource + 0x60);
  buffer.writeUInt32LE(0x80, resource + 0x64);
  buffer.writeUInt16LE(1, resource + 0x68 + 14);
  buffer.writeUInt32LE(1033, resource + 0x78);
  buffer.writeUInt32LE(0x90, resource + 0x7c);
  buffer.writeUInt32LE(0x30a0, resource + 0x80);
  buffer.writeUInt32LE(4, resource + 0x84);
  buffer.writeUInt32LE(0, resource + 0x88);
  buffer.writeUInt32LE(3, resource + 0xa0);

  const embeddedConfig = Buffer.from(
    options.embeddedConfig ?? 'enabled = true\n',
    'utf8',
  );
  buffer.writeUInt32LE(0x30b0, resource + 0x90);
  buffer.writeUInt32LE(embeddedConfig.length, resource + 0x94);
  buffer.writeUInt32LE(0, resource + 0x98);
  embeddedConfig.copy(buffer, resource + 0xb0);
  return buffer;
}
