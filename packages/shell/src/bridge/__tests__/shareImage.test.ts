// Stubs for the lazily-require()d natives, registered before the import.
const mockWrite = jest.fn();
const mockCreate = jest.fn();
const mockShare = jest.fn();
const mockShareAsync = jest.fn();
const mockIsAvailable = jest.fn();

jest.mock('expo-file-system', () => ({
  Paths: { cache: '/mock-cache' },
  File: jest.fn().mockImplementation((_dir: string, name: string) => ({
    create: mockCreate,
    write: mockWrite,
    uri: `file:///mock-cache/${name}`,
  })),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => mockIsAvailable(),
  shareAsync: (uri: string, opts: unknown) => mockShareAsync(uri, opts),
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Share: {
    share: (content: unknown) => mockShare(content),
    sharedAction: 'sharedAction',
    dismissedAction: 'dismissedAction',
  },
}));

import { Platform } from 'react-native';
import { shareImageFile } from '../shareImage';

// Handing a page to the OS share sheet. Like the camera-roll save beside it,
// this must never throw — the caller decides how to surface a failure.

beforeEach(() => {
  mockWrite.mockClear();
  mockCreate.mockClear();
  mockShare.mockClear().mockResolvedValue({ action: 'sharedAction' });
  mockShareAsync.mockClear().mockResolvedValue(undefined);
  mockIsAvailable.mockClear().mockResolvedValue(true);
  (Platform as { OS: string }).OS = 'ios';
});

describe('shareImageFile on iOS', () => {
  test('shares the written file WITH the message, so both travel together', async () => {
    // The whole point of the iOS path: a page shared to Messages carries the
    // picture and the line saying where it came from.
    const result = await shareImageFile('dGVzdA==', 'page.png', 'image/png', 'Look — get the app');

    expect(result).toEqual({ success: true });
    expect(mockWrite).toHaveBeenCalledWith('dGVzdA==', { encoding: 'base64' });
    expect(mockShare).toHaveBeenCalledWith({
      message: 'Look — get the app',
      url: 'file:///mock-cache/page.png',
    });
  });

  test('a dismissed sheet is cancelled, not a failure', async () => {
    mockShare.mockResolvedValue({ action: 'dismissedAction' });
    expect(await shareImageFile('dGVzdA==', 'page.png', 'image/png', 'hi')).toEqual({
      success: false,
      error: 'cancelled',
    });
  });

  test('overwrites a same-named cache file rather than failing the second share', async () => {
    await shareImageFile('dGVzdA==', 'page.png', 'image/png', 'hi');
    await shareImageFile('dGVzdA==', 'page.png', 'image/png', 'hi');
    expect(mockCreate).toHaveBeenNthCalledWith(2, { overwrite: true });
    expect(mockShare).toHaveBeenCalledTimes(2);
  });
});

describe('shareImageFile elsewhere', () => {
  beforeEach(() => {
    (Platform as { OS: string }).OS = 'android';
  });

  test('goes through expo-sharing with the file’s real type', async () => {
    const result = await shareImageFile('dGVzdA==', 'page.jpg', 'image/jpeg', 'Look');

    expect(result).toEqual({ success: true });
    expect(mockShare).not.toHaveBeenCalled();
    expect(mockShareAsync).toHaveBeenCalledWith('file:///mock-cache/page.jpg', {
      mimeType: 'image/jpeg',
      dialogTitle: 'Look',
    });
  });

  test('a device with no share sheet says so instead of failing silently', async () => {
    mockIsAvailable.mockResolvedValue(false);
    expect(await shareImageFile('dGVzdA==', 'page.jpg', 'image/jpeg', 'Look')).toEqual({
      success: false,
      error: 'unavailable',
    });
    expect(mockShareAsync).not.toHaveBeenCalled();
  });
});

describe('failures', () => {
  test('a throw comes back as an error, not a rejection', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockShare.mockRejectedValue(new Error('no sheet'));
    await expect(shareImageFile('dGVzdA==', 'page.png', 'image/png', 'hi')).resolves.toEqual({
      success: false,
      error: 'no sheet',
    });
  });

  test('a non-Error throw still yields a usable message', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockShare.mockRejectedValue('nope');
    const result = await shareImageFile('dGVzdA==', 'page.png', 'image/png', 'hi');
    expect(result).toEqual({ success: false, error: 'nope' });
  });
});
