jest.mock('expo-file-system', () => ({ Paths: { cache: '/mock-cache' }, File: jest.fn() }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn() }));

import { handleNativeMessage, setLogListener, type LogPayload } from '../nativeBridge';

// A consuming app may hear the web side's LOG messages as they arrive
// (setLogListener): the console line every level always wrote is still
// written first, and a listener that throws changes nothing.

const sendToWeb = jest.fn();

afterEach(() => {
  setLogListener(null);
  jest.restoreAllMocks();
});

function log(level: LogPayload['level'], tag: string, text: string): void {
  handleNativeMessage({ type: 'LOG', payload: { level, tag, text } }, sendToWeb);
}

describe('setLogListener', () => {
  it('hands every LOG payload to the listener, whatever its level', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const seen: LogPayload[] = [];
    setLogListener((p) => seen.push(p));
    log('error', 'window.error', 'TypeError: x');
    log('warn', 'perf', 'slow');
    log('log', 'note', 'hi');
    expect(seen).toEqual([
      { level: 'error', tag: 'window.error', text: 'TypeError: x' },
      { level: 'warn', tag: 'perf', text: 'slow' },
      { level: 'log', tag: 'note', text: 'hi' },
    ]);
  });

  it('still writes the console line first, and survives a listener that throws', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    setLogListener(() => {
      throw new Error('listener fault');
    });
    expect(() => log('error', 'unhandledrejection', 'boom')).not.toThrow();
    expect(error).toHaveBeenCalledWith('[web:unhandledrejection]', 'boom');
  });

  it('is off once cleared', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const listener = jest.fn();
    setLogListener(listener);
    setLogListener(null);
    log('log', 'note', 'hi');
    expect(listener).not.toHaveBeenCalled();
  });
});
