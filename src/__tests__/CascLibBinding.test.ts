const mockBoundFunctions = new Map<string, jest.Mock>();
const mockFunc = jest.fn((signature: string) => {
  const boundFunction = jest.fn();
  mockBoundFunctions.set(signature, boundFunction);
  return boundFunction;
});
const mockLoad = jest.fn((_libraryPath: string) => ({ func: mockFunc }));

jest.mock('koffi', () => ({
  __esModule: true,
  default: {
    load: (libraryPath: string) => mockLoad(libraryPath),
    sizeof: jest.fn(() => 96),
    struct: jest.fn(() => ({})),
  },
}));

jest.mock('main/worker/AppInfoAPI', () => ({
  getAppPath: () => 'C:\\D2RMM-F18-FAKE\\app',
}));

import { getCascLib, initCascLib } from '../main/worker/CascLib';

describe('CascLib native bindings', () => {
  beforeEach(() => {
    mockBoundFunctions.clear();
    mockFunc.mockClear();
    mockLoad.mockClear();
  });

  it('binds the exported 64-bit size query and an unsigned DWORD read size', async () => {
    await initCascLib();

    const sizeSignature =
      'bool CascGetFileSize64(void *file, _Out_ uint64_t *fileSize)';
    const readSignature =
      'bool CascReadFile(void *file, void *buffer, uint32_t size, _Out_ uint32_t *bytesRead)';

    expect(mockFunc).toHaveBeenCalledWith(sizeSignature);
    expect(mockFunc).toHaveBeenCalledWith(readSignature);
    expect(getCascLib().CascGetFileSize64).toBe(
      mockBoundFunctions.get(sizeSignature),
    );
    expect(getCascLib().CascReadFile).toBe(
      mockBoundFunctions.get(readSignature),
    );
  });
});
