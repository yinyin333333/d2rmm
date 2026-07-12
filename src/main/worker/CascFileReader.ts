import type { ICascLib } from './CascLib';
import { constants as bufferConstants } from 'buffer';

export const MAX_CASC_SINGLE_READ_SIZE = Math.min(
  bufferConstants.MAX_LENGTH,
  0xffffffff,
);

export type CascFileReadErrorKind =
  | 'closeFailed'
  | 'invalidSize'
  | 'readFailed'
  | 'shortRead'
  | 'sizeQueryFailed'
  | 'tooLarge';

export class CascFileReadError extends Error {
  constructor(
    public readonly kind: CascFileReadErrorKind,
    public readonly cascError: number | null = null,
    public readonly fileSize: unknown = null,
    public readonly expectedBytes: number | null = null,
    public readonly actualBytes: number | null = null,
  ) {
    super(
      [
        `CASC file read failed (${kind})`,
        cascError == null ? null : `CASC error ${cascError}`,
        fileSize == null ? null : `size ${String(fileSize)}`,
        expectedBytes == null ? null : `expected ${expectedBytes}`,
        actualBytes == null ? null : `actual ${actualBytes}`,
      ]
        .filter((part) => part != null)
        .join(', '),
    );
    this.name = 'CascFileReadError';
  }
}

export function normalizeCascFileSize(fileSize: unknown): number {
  let normalizedSize: bigint;
  if (typeof fileSize === 'bigint') {
    normalizedSize = fileSize;
  } else if (
    typeof fileSize === 'number' &&
    Number.isSafeInteger(fileSize)
  ) {
    normalizedSize = BigInt(fileSize);
  } else {
    throw new CascFileReadError('invalidSize', null, fileSize);
  }

  if (normalizedSize < 0n) {
    throw new CascFileReadError('invalidSize', null, fileSize);
  }
  if (normalizedSize > BigInt(MAX_CASC_SINGLE_READ_SIZE)) {
    throw new CascFileReadError('tooLarge', null, fileSize);
  }

  return Number(normalizedSize);
}

function readCascFileContent(
  cascLib: ICascLib,
  file: unknown,
): Buffer {
  const fileSizeOut: (bigint | number)[] = [0];
  if (!cascLib.CascGetFileSize64(file, fileSizeOut)) {
    throw new CascFileReadError(
      'sizeQueryFailed',
      cascLib.GetCascError(),
    );
  }

  const fileSize = normalizeCascFileSize(fileSizeOut[0]);
  const buffer = Buffer.alloc(fileSize);
  if (fileSize === 0) {
    return buffer;
  }

  const bytesReadOut: number[] = [0];
  if (!cascLib.CascReadFile(file, buffer, fileSize, bytesReadOut)) {
    throw new CascFileReadError('readFailed', cascLib.GetCascError());
  }
  if (bytesReadOut[0] !== fileSize) {
    throw new CascFileReadError(
      'shortRead',
      null,
      fileSize,
      fileSize,
      bytesReadOut[0],
    );
  }

  return buffer;
}

type ReadOutcome =
  | { ok: true; value: Buffer }
  | { error: unknown; ok: false };

export function readCascFileToBuffer(
  cascLib: ICascLib,
  file: unknown,
): Buffer {
  let readOutcome: ReadOutcome;
  try {
    readOutcome = { ok: true, value: readCascFileContent(cascLib, file) };
  } catch (error) {
    readOutcome = { error, ok: false };
  }

  let closeOutcome: { ok: true } | { error: unknown; ok: false };
  try {
    closeOutcome = cascLib.CascCloseFile(file)
      ? { ok: true }
      : {
          error: new CascFileReadError(
            'closeFailed',
            cascLib.GetCascError(),
          ),
          ok: false,
        };
  } catch (error) {
    closeOutcome = { error, ok: false };
  }

  if (!closeOutcome.ok) {
    throw closeOutcome.error;
  }
  if (!readOutcome.ok) {
    throw readOutcome.error;
  }
  return readOutcome.value;
}
