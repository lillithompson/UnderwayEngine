// Stubs for expo-file-system and expo-sharing
const mockWrite = jest.fn();
const mockCreate = jest.fn();
const mockShareAsync = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-file-system', () => ({
  Paths: { cache: '/mock-cache' },
  File: jest.fn().mockImplementation(() => ({
    create: mockCreate,
    write: mockWrite,
    uri: 'file:///mock-cache/test',
  })),
}));

jest.mock('expo-sharing', () => ({
  shareAsync: (...args: unknown[]) => mockShareAsync(...args),
}));

import { handleNativeMessage } from '../nativeBridge';

beforeEach(() => {
  mockWrite.mockClear();
  mockCreate.mockClear();
  mockShareAsync.mockClear();
});

function shareAndCapture(
  filename: string,
  mimeType: string,
  data = 'dGVzdA==',
  uti?: string,
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    handleNativeMessage(
      {
        type: 'SHARE_FILE',
        payload: { data, filename, mimeType, uti },
      },
      (msg) => {
        if (msg.type === 'SHARE_RESULT') resolve(msg.payload);
      },
    );
  });
}

describe('handleShareFile isBase64 detection', () => {
  test('.png files are written with base64 encoding', async () => {
    await shareAndCapture('test.png', 'image/png');
    expect(mockWrite).toHaveBeenCalledWith('dGVzdA==', { encoding: 'base64' });
  });

  test('.tile files are written with base64 encoding', async () => {
    await shareAndCapture('test.tile', 'application/octet-stream');
    expect(mockWrite).toHaveBeenCalledWith('dGVzdA==', { encoding: 'base64' });
  });

  test('.zip files are written with base64 encoding', async () => {
    await shareAndCapture('compositions-svg.zip', 'application/zip');
    expect(mockWrite).toHaveBeenCalledWith('dGVzdA==', { encoding: 'base64' });
  });

  test('image/* (non-svg) files are written with base64 encoding', async () => {
    await shareAndCapture('photo.jpg', 'image/jpeg');
    expect(mockWrite).toHaveBeenCalledWith('dGVzdA==', { encoding: 'base64' });
  });

  test('.svg files are written as plain text', async () => {
    await shareAndCapture('figure.svg', 'image/svg+xml', '<svg/>');
    expect(mockWrite).toHaveBeenCalledWith('<svg/>');
  });

  test('plain text files are written as plain text', async () => {
    await shareAndCapture('data.json', 'application/json', '{}');
    expect(mockWrite).toHaveBeenCalledWith('{}');
  });

  test('successful share sends success result', async () => {
    const result = await shareAndCapture('test.zip', 'application/zip');
    expect(result).toEqual({ success: true });
  });
});

describe('APP_EVENT', () => {
  // Late import so the module-level handler registry is the same instance
  // the dispatcher uses.
  const { setAppEventHandler } = require('../nativeBridge');

  afterEach(() => setAppEventHandler(null));

  test('dispatches kind/data to the registered handler', () => {
    const handler = jest.fn();
    setAppEventHandler(handler);
    handleNativeMessage(
      { type: 'APP_EVENT', payload: { kind: 'homeState', data: { entries: 3 } } },
      () => {},
    );
    expect(handler).toHaveBeenCalledWith('homeState', { entries: 3 });
  });

  test('drops events with no handler registered', () => {
    expect(() =>
      handleNativeMessage(
        { type: 'APP_EVENT', payload: { kind: 'navigate' } },
        () => {},
      ),
    ).not.toThrow();
  });
});
