import React from 'react';
import {
  PATTERN_TILE_TRANSFORM_IDENTITY,
  type PatternTileRow,
  type PatternTileTransform,
} from '@/editor-ui/logic/patternEdit';
import { PatternTileTransformModal } from '@/editor-ui/components/PatternTileTransformModal';

// The transform card a long press on the Choose capsule opens: the same card
// the Tiles takeover's grid raises over itself (rotate, flip either axis),
// posing the tile in hand through the same record (onPatternSetTileTransform),
// so the capsule segment, the ring and the next stamp follow every press.
//
// The card is addressed by the TILE's id rather than held open by a flag:
// `tileTransformCardId` is both "which tile" and "is it open", so there is no
// state in which the card is up over no tile.
//
// The props carry the shell's own names, and the body below is the shell's
// text unchanged — which is what makes "byte-identical in three shipped apps"
// the thing a reviewer can check.
export function TileTransformCard({
  tileTransformCardId, patternTiles, patternTileTransforms,
  onPatternSetTileTransform, setTileTransformCardId,
}: {
  tileTransformCardId: string | null;
  patternTiles: readonly PatternTileRow[];
  patternTileTransforms: Readonly<Record<string, PatternTileTransform>>;
  onPatternSetTileTransform: (id: string, transform: PatternTileTransform) => void;
  setTileTransformCardId: (id: string | null) => void;
}) {
  return (
    <PatternTileTransformModal
      visible={tileTransformCardId != null}
      uri={tileTransformCardId
        ? patternTiles.find((t) => t.id === tileTransformCardId)?.uri ?? null
        : null}
      transform={(tileTransformCardId && patternTileTransforms[tileTransformCardId])
        || PATTERN_TILE_TRANSFORM_IDENTITY}
      onChange={(xform) => {
        if (tileTransformCardId) onPatternSetTileTransform(tileTransformCardId, xform);
      }}
      onClose={() => setTileTransformCardId(null)}
    />
  );
}
