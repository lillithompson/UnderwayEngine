export interface SpriteEntry {
  id: string;
  label: string;
  family: string;
  connectionCount: number;
}

export const SPRITE_ENTRIES: SpriteEntry[] = [
  { id: 'test/tile_00000000', label: 'tile_00000000', family: 'test', connectionCount: 0 },
  { id: 'test/tile_11111111', label: 'tile_11111111', family: 'test', connectionCount: 8 },
  { id: 'test/tile_10101010', label: 'tile_10101010', family: 'test', connectionCount: 4 },
  { id: 'test/tile_01010101', label: 'tile_01010101', family: 'test', connectionCount: 4 },
  { id: 'test/tile_10001000', label: 'tile_10001000', family: 'test', connectionCount: 2 },
  { id: 'test/tile_00100010', label: 'tile_00100010', family: 'test', connectionCount: 2 },
  { id: 'test/unconstrained', label: 'unconstrained', family: 'test', connectionCount: 0 },
  { id: 'test/tile_10000010', label: 'tile_10000010', family: 'test', connectionCount: 2 },
  { id: 'test/tile_00001010', label: 'tile_00001010', family: 'test', connectionCount: 2 },
  { id: 'test/tile_10000000', label: 'tile_10000000', family: 'test', connectionCount: 1 },
  { id: 'test/tile_00010000', label: 'tile_00010000', family: 'test', connectionCount: 1 },
  { id: 'test2/tile_00100010', label: 'tile_00100010', family: 'test2', connectionCount: 2 },
];
export function loadAllSprites(): Promise<void> { return Promise.resolve(); }
export function loadL0Atlas(): Promise<void> { return Promise.resolve(); }
export function getScaledTile(_spriteId: string, _level: number): Uint8Array | null { return null; }
export function onAtlasUpgrade(_cb: () => void): () => void { return () => {}; }
export function preloadForFile(_spriteIds: string[]): void {}
export function upgradeAtlas(_family: string, _level: number): Promise<void> { return Promise.resolve(); }
export function isPaintingActive(): boolean { return false; }
export function onPaintingEnd(_cb: () => void): () => void { return () => {}; }
export function setPaintingActive(_active: boolean): void {}
