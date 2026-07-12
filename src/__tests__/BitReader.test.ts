import { TextDecoder as NodeTextDecoder } from 'util';
import { BitReader } from '../main/worker/third-party/d2s/binary/bitreader';

Object.defineProperty(globalThis, 'TextDecoder', {
  configurable: true,
  value: NodeTextDecoder,
});

function bufferOf(...bytes: number[]): ArrayBuffer {
  return Uint8Array.from(bytes).buffer as ArrayBuffer;
}

function expectRejectedWithoutMoving(
  reader: BitReader,
  operation: () => unknown,
): void {
  const offset = reader.offset;
  expect(operation).toThrow();
  expect(reader.offset).toBe(offset);
}

describe('BitReader bounds', () => {
  it('allows empty operations at the zero-byte boundary', () => {
    const reader = new BitReader(new ArrayBuffer(0));
    const destination = new Uint8Array(0);

    expect(reader.ReadBitArray(0)).toEqual(new Uint8Array(0));
    expect(reader.ReadBits(destination, 0)).toBe(destination);
    expect(reader.SeekBit(0)).toBe(reader);
    expect(reader.SkipBits(0)).toBe(reader);
    expect(reader.Align()).toBe(reader);
    expect(reader.offset).toBe(0);

    expectRejectedWithoutMoving(reader, () => reader.ReadBit());
  });

  it('allows an exact read to EOF and rejects the next bit atomically', () => {
    const reader = new BitReader(bufferOf(0xa5));

    expect(reader.ReadByte()).toBe(0xa5);
    expect(reader.offset).toBe(8);
    expectRejectedWithoutMoving(reader, () => reader.ReadBit());
  });

  it.each([-1, 0.5, Number.NaN])(
    'rejects invalid ReadBitArray count %p without moving',
    (count) => {
      const reader = new BitReader(bufferOf(0xff));

      expectRejectedWithoutMoving(reader, () => reader.ReadBitArray(count));
    },
  );

  it.each([-1, 0.5, Number.NaN])(
    'rejects invalid ReadBits count %p without moving or changing output',
    (count) => {
      const reader = new BitReader(bufferOf(0xff));
      const destination = new Uint8Array([0x5a]);

      expectRejectedWithoutMoving(reader, () =>
        reader.ReadBits(destination, count),
      );
      expect(destination).toEqual(new Uint8Array([0x5a]));
    },
  );

  it('prevalidates source capacity before changing the destination', () => {
    const reader = new BitReader(bufferOf(0xff)).SeekBit(4);
    const destination = new Uint8Array([0x50]);

    expectRejectedWithoutMoving(reader, () => reader.ReadBits(destination, 5));
    expect(destination).toEqual(new Uint8Array([0x50]));
  });

  it('prevalidates destination capacity before reading', () => {
    const reader = new BitReader(bufferOf(0xff, 0xff));
    const destination = new Uint8Array([0x5a]);

    expectRejectedWithoutMoving(reader, () => reader.ReadBits(destination, 9));
    expect(destination).toEqual(new Uint8Array([0x5a]));
  });

  it('rejects fractional byte reads before moving', () => {
    const reader = new BitReader(bufferOf(0xff));

    expectRejectedWithoutMoving(reader, () => reader.ReadBytes(0.5));
  });

  it.each([-1, 9, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid bit seek target %p atomically',
    (offset) => {
      const reader = new BitReader(bufferOf(0xff)).SeekBit(4);

      expectRejectedWithoutMoving(reader, () => reader.SeekBit(offset));
    },
  );

  it('preserves valid negative SkipBits used by speculative parsing', () => {
    const reader = new BitReader(bufferOf(0xff, 0xff));

    reader.SeekBit(12).SkipBits(-12);

    expect(reader.offset).toBe(0);
  });

  it.each([
    -5,
    5,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects invalid bit skip %p atomically', (count) => {
    const reader = new BitReader(bufferOf(0xff)).SeekBit(4);

    expectRejectedWithoutMoving(reader, () => reader.SkipBits(count));
  });

  it('validates byte seek and skip arguments before conversion to bits', () => {
    const seekReader = new BitReader(bufferOf(0xff));
    const skipReader = new BitReader(bufferOf(0xff)).SeekBit(4);

    expectRejectedWithoutMoving(seekReader, () => seekReader.SeekByte(0.5));
    expectRejectedWithoutMoving(skipReader, () => skipReader.SkipBytes(0.5));
  });

  it('aligns a valid cursor and rejects an invalid public cursor', () => {
    const reader = new BitReader(bufferOf(0xff)).SeekBit(1);
    reader.Align();
    expect(reader.offset).toBe(8);

    reader.offset = 0.5;
    expectRejectedWithoutMoving(reader, () => reader.Align());

    reader.offset = 9;
    expectRejectedWithoutMoving(reader, () => reader.Align());
  });

  it('rejects unterminated strings at EOF without advancing past capacity', () => {
    const emptyReader = new BitReader(new ArrayBuffer(0));
    expectRejectedWithoutMoving(emptyReader, () =>
      emptyReader.ReadNullTerminatedString(),
    );

    const truncatedReader = new BitReader(bufferOf(0x41));
    expect(() => truncatedReader.ReadNullTerminatedString()).toThrow();
    expect(truncatedReader.offset).toBe(8);
  });

  it('reads a terminated string and leaves the cursor after the terminator', () => {
    const reader = new BitReader(bufferOf(0x41, 0x00));

    expect(reader.ReadNullTerminatedString()).toBe('A');
    expect(reader.offset).toBe(16);
  });
});
