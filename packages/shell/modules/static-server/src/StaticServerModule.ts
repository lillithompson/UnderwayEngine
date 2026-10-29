import { requireNativeModule } from 'expo-modules-core';

/**
 * What adoptLegacyOrigin found: no port to adopt from (`none`), adopted on
 * an earlier launch (`done`), nothing was ever stored on this install
 * (`fresh`), or copied just now, with what was copied (`migrated`).
 */
export interface LegacyOriginAdoption {
  status: 'none' | 'done' | 'fresh' | 'migrated';
  databases?: number;
  records?: number;
  localStorage?: number;
}

interface StaticServerModuleInterface {
  startServer(documentRoot: string): Promise<string>;
  stopServer(): Promise<void>;
  adoptLegacyOrigin(): Promise<LegacyOriginAdoption>;
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

/**
 * Bring the install's saved work from the port this app used to serve on
 * (Info.plist `UnderwayStaticServerLegacyPort`) to the one it serves on now,
 * once; a no-op for an app that never moved. Call after startServer and
 * BEFORE the page loads — a page that opens on the new origin first finds
 * an empty journal. Rejects when the copy could not be completed; nothing
 * is marked then, and the next call starts over.
 */
export function adoptLegacyOrigin(): Promise<LegacyOriginAdoption> {
  return NativeModule.adoptLegacyOrigin();
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
