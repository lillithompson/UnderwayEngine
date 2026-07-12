/**
 * Sprite manifest in a pure module (no expo / GL imports), so binary
 * serialization and other build-time tooling can use it without loading
 * the GL-backed `loadTile.ts` runtime.
 */

import manifest from '../assets/images/atlases/manifest.json';

export interface SpriteEntry {
  id: string;
  label: string;
  family: string;
  connectionCount: number;
}

interface ManifestEntry {
  spriteId: string;
  family: string;
  connectionCount: number;
  atlases: Record<string, { file: string; col: number; row: number }>;
}

const MANIFEST = manifest as Record<string, ManifestEntry>;

export const SPRITE_ENTRIES: SpriteEntry[] = Object.values(MANIFEST).map((entry) => ({
  id: entry.spriteId,
  label: entry.spriteId.split('/')[1] || entry.spriteId,
  family: entry.family,
  connectionCount: entry.connectionCount,
}));
