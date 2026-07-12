import { te } from '../../../../../shared/i18n';

export class BitReader {
  public littleEndian = true;
  public bits: Uint8Array;
  public offset = 0;

  constructor(arrBuffer: ArrayBuffer) {
    const typedArray = new Uint8Array(arrBuffer);
    this.bits = new Uint8Array(typedArray.length * 8);
    typedArray.reduce((acc: number, c: number) => {
      const b = c
        .toString(2)
        .padStart(8, '0')
        .split('')
        .reverse()
        .map((e) => parseInt(e, 2));
      b.forEach((bit) => (this.bits[acc++] = bit));
      return acc;
    }, 0);
  }

  private assertSafeInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`${name} must be a safe integer.`);
    }
  }

  private assertOffset(offset: number, name: string): void {
    this.assertSafeInteger(offset, name);
    if (offset < 0 || offset > this.bits.length) {
      throw new RangeError(
        `${name} must be between 0 and ${this.bits.length} bits.`,
      );
    }
  }

  private bitCountFromBytes(
    bytes: number,
    name: string,
    allowNegative = false,
  ): number {
    this.assertSafeInteger(bytes, name);
    if (!allowNegative && bytes < 0) {
      throw new RangeError(`${name} must not be negative.`);
    }
    const bitCount = bytes * 8;
    this.assertSafeInteger(bitCount, name);
    return bitCount;
  }

  private readEnd(count: number, singleBit = false): number {
    this.assertSafeInteger(count, 'Bit count');
    if (count < 0) {
      throw new RangeError('Bit count must not be negative.');
    }
    this.assertOffset(this.offset, 'Bit reader offset');
    if (count > this.bits.length - this.offset) {
      const byteOffset = Math.floor(this.offset / 8);
      if (singleBit) {
        throw te('d2s.binary.readBit.overflow', {
          byteOffset,
          bitOffset: this.offset,
          bufferSize: this.bits.length / 8,
        });
      }
      const bytesNeeded = Math.ceil(count / 8);
      const bytesAvailable = Math.floor((this.bits.length - this.offset) / 8);
      throw te('d2s.binary.readBitArray.overflow', {
        count,
        bytesNeeded,
        byteOffset,
        bytesAvailable,
      });
    }
    return this.offset + count;
  }

  public ReadBit(): number {
    const end = this.readEnd(1, true);
    const bit = this.bits[this.offset];
    this.offset = end;
    return bit;
  }

  public ReadBitArray(count: number): Uint8Array {
    const start = this.offset;
    const end = this.readEnd(count);
    const bits = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      bits[i] = this.bits[start + i];
    }
    this.offset = end;
    return bits;
  }

  public ReadBits(bytes: Uint8Array, count: number): Uint8Array {
    const start = this.offset;
    const end = this.readEnd(count);
    const destinationCapacity = bytes.length * 8;
    if (count > destinationCapacity) {
      throw new RangeError(
        `Cannot read ${count} bits into a ${destinationCapacity}-bit destination.`,
      );
    }
    let byteIndex = 0;
    let bitIndex = 0;
    for (let i = 0; i < count; i++) {
      if (this.bits[start + i]) {
        bytes[byteIndex] |= (1 << bitIndex) & 0xff;
      }
      bitIndex++;
      if (bitIndex == 8) {
        byteIndex++;
        bitIndex = 0;
      }
    }
    this.offset = end;
    return bytes;
  }

  public ReadBytes(bytes: number): Uint8Array {
    const bitCount = this.bitCountFromBytes(bytes, 'Byte count');
    return this.ReadBits(new Uint8Array(bytes), bitCount);
  }

  public ReadArray(bytes: number): Uint8Array {
    return this.ReadBytes(bytes);
  }

  public ReadByte(bits = 8): number {
    const dataview = new DataView(
      this.ReadBits(new Uint8Array(1), bits).buffer,
    );
    return dataview.getUint8(0);
  }

  public ReadUInt8(bits = 8): number {
    return this.ReadByte(bits);
  }

  public ReadUInt16(bits: number = 8 * 2): number {
    const dataview = new DataView(
      this.ReadBits(new Uint8Array(2), bits).buffer,
    );
    return dataview.getUint16(0, this.littleEndian);
  }

  public ReadUInt32(bits: number = 8 * 4): number {
    const dataview = new DataView(
      this.ReadBits(new Uint8Array(4), bits).buffer,
    );
    return dataview.getUint32(0, this.littleEndian);
  }

  public ReadString(bytes: number): string {
    try {
      const buffer = this.ReadBytes(bytes).buffer;
      return new TextDecoder().decode(buffer);
    } catch (error) {
      const byteOffset = Math.floor(this.offset / 8);
      throw te('d2s.binary.readString.failed', {
        bytes,
        byteOffset,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  public ReadNullTerminatedString(): string {
    const start = this.offset;
    while (this.ReadByte()) {}
    const end = this.offset - 8;
    const buffer = this.SeekBit(start).ReadBytes((end - start) / 8);
    this.SeekBit(end + 8);
    return new TextDecoder().decode(buffer);
  }

  public SkipBits(number: number): BitReader {
    this.assertSafeInteger(number, 'Bit skip');
    this.assertOffset(this.offset, 'Bit reader offset');
    return this.SeekBit(this.offset + number);
  }

  public SkipBytes(number: number): BitReader {
    return this.SkipBits(this.bitCountFromBytes(number, 'Byte skip', true));
  }

  public SeekBit(offset: number): BitReader {
    this.assertOffset(offset, 'Bit seek offset');
    this.offset = offset;
    return this;
  }

  public SeekByte(offset: number): BitReader {
    return this.SeekBit(this.bitCountFromBytes(offset, 'Byte seek offset'));
  }

  public Align(): BitReader {
    this.assertOffset(this.offset, 'Bit reader offset');
    const remainder = this.offset % 8;
    return this.SeekBit(
      remainder === 0 ? this.offset : this.offset + 8 - remainder,
    );
  }
}
