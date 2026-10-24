import { toBase64 } from '@/engine/pngcodec';

// An image's bytes as a ready-to-use data URI, its mime read off the bytes
// themselves. Every journal image is drawn to whichever encoder its pixels
// call for — PNG where the frame has transparency, JPEG where it is opaque
// (web/editor/entryRaster.ts) — so no store, bridge field, upload or
// download can assume a format: the bytes say. Used by the home-state
// bridge for the images it ships and by the friends client for the ones it
// fetches, so a JPEG view served under a stale PNG header still opens as
// what it is.

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/gif';

/** The image type the bytes declare — JPEG's `FF D8 FF`, PNG's
 *  `89 50 4E 47`, GIF's `GIF8` (a match replay, CozyJournal's docs/social_game_spec.md
 *  §4.12: the one GIF the app fetches) — or null for anything else. */
export function imageMimeOf(bytes: Uint8Array): ImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
  return null;
}

/** `data:<mime>;base64,…` for the bytes. `fallback` names bytes of no known
 *  magic — PNG by default, the journal's own encoding before this sniff. */
export function bytesToDataUri(bytes: Uint8Array, fallback: string = 'image/png'): string {
  return `data:${imageMimeOf(bytes) ?? fallback};base64,${toBase64(bytes)}`;
}
