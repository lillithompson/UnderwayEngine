import { requireNativeModule } from 'expo-modules-core';

interface StaticServerModuleInterface {
  startServer(documentRoot: string): Promise<string>;
  stopServer(): Promise<void>;
  getPort(): number;
  getWebBundlePath(): string | null;
  getPackagerHost(): string | null;
}

const NativeModule = requireNativeModule<StaticServerModuleInterface>('StaticServer');

/** Start serving static files from `documentRoot`. Returns the base URL (e.g. http://localhost:PORT). */
export function startServer(documentRoot: string): Promise<string> {
  return NativeModule.startServer(documentRoot);
}

/** Stop the running server. */
export function stopServer(): Promise<void> {
  return NativeModule.stopServer();
}

/** Return the port the server is listening on (0 if not started). */
export function getPort(): number {
  return NativeModule.getPort();
}

/** Return the path to web-bundle/ inside the app's main bundle. Null if not found. */
export function getWebBundlePath(): string | null {
  return NativeModule.getWebBundlePath();
}

/** Return the Metro packager host (IP or hostname) from the native side. Null in release builds. */
export function getPackagerHost(): string | null {
  return NativeModule.getPackagerHost();
}
