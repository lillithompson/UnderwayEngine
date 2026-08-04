// Stubs for expo-file-system and expo-media-library (the module require()s
// both lazily, so the mocks must be registered before the import below).
const mockWrite = jest.fn();
const mockCreate = jest.fn();
const mockRequestPermissions = jest.fn();
const mockSaveToLibrary = jest.fn();

jest.mock('expo-file-system', () => ({
  Paths: { cache: '/mock-cache' },
  File: jest.fn().mockImplementation((_dir: string, name: string) => ({
    create: mockCreate,
    write: mockWrite,
    uri: `file:///mock-cache/${name}`,
  })),
}));

jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: () => mockRequestPermissions(),
  saveToLibraryAsync: (uri: string) => mockSaveToLibrary(uri),
}));

import { saveBase64ToCameraRoll } from '../cameraRoll';

// The one "base64 → cache file → photo library" implementation, shared by the
// SAVE_TO_CAMERA_ROLL bridge message and by RN screens that save directly
// (CozyJournal's Journal viewer). It must never throw — callers decide how to
// surface a failure, and an unhandled rejection here would take down a save
// the user explicitly asked for.

beforeEach(() => {
  mockWrite.mockClear();
  mockCreate.mockClear();
  mockSaveToLibrary.mockClear().mockResolvedValue(undefined);
  mockRequestPermissions.mockClear().mockResolvedValue({ status: 'granted' });
});

describe('saveBase64ToCameraRoll', () => {
  test('writes the bytes as base64 and adds the file to the library', async () => {
    const result = await saveBase64ToCameraRoll('dGVzdA==', 'page.jpg');

    expect(result).toEqual({ success: true });
    expect(mockCreate).toHaveBeenCalledWith({ overwrite: true });
    expect(mockWrite).toHaveBeenCalledWith('dGVzdA==', { encoding: 'base64' });
    expect(mockSaveToLibrary).toHaveBeenCalledWith('file:///mock-cache/page.jpg');
  });

  test('overwrites a same-named cache file rather than failing the second save', async () => {
    await saveBase64ToCameraRoll('dGVzdA==', 'page.jpg');
    await saveBase64ToCameraRoll('dGVzdA==', 'page.jpg');
    expect(mockCreate).toHaveBeenNthCalledWith(2, { overwrite: true });
    expect(mockSaveToLibrary).toHaveBeenCalledTimes(2);
  });

  test('declined permission reports permission_denied and writes nothing', async () => {
    mockRequestPermissions.mockResolvedValue({ status: 'denied' });

    const result = await saveBase64ToCameraRoll('dGVzdA==', 'page.jpg');

    expect(result).toEqual({ success: false, error: 'permission_denied' });
    expect(mockWrite).not.toHaveBeenCalled();
    expect(mockSaveToLibrary).not.toHaveBeenCalled();
  });

  test('a library failure comes back as an error, not a rejection', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSaveToLibrary.mockRejectedValue(new Error('disk full'));

    await expect(saveBase64ToCameraRoll('dGVzdA==', 'page.jpg')).resolves.toEqual({
      success: false,
      error: 'disk full',
    });
  });

  test('a non-Error throw still yields a usable message', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockRequestPermissions.mockRejectedValue('nope');

    const result = await saveBase64ToCameraRoll('dGVzdA==', 'page.jpg');
    expect(result.success).toBe(false);
    expect(result.error).toBe('nope');
  });
});
