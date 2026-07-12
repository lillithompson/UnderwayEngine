// Test shim: loadTile.ts is module-mapped to its mock under jest; this exists
// so `tsc --noEmit` can typecheck the real file until the Expo leak is removed.
// Mirrors the Asset fields loadTile actually reads.
export interface ShimAsset {
  downloadAsync(): Promise<void>;
  localUri?: string | null;
  uri: string;
  width?: number | null;
  height?: number | null;
}
export const Asset: { fromModule: (m: unknown) => ShimAsset } = {
  fromModule: () => ({ downloadAsync: async () => {}, localUri: null, uri: '' }),
};
