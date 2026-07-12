import { CellTransform, applyVisualMirror } from '../types';

const t = (rotation: 0 | 90 | 180 | 270, mirrorH = false, mirrorV = false): CellTransform => ({
  rotation,
  mirrorH,
  mirrorV,
});

describe('applyVisualMirror', () => {
  describe('mirror H', () => {
    it('at rotation 0 only toggles mirrorH', () => {
      expect(applyVisualMirror(t(0), 'h')).toEqual(t(0, true));
    });

    it('at rotation 90 sets rotation to 270', () => {
      expect(applyVisualMirror(t(90), 'h')).toEqual(t(270, true));
    });

    it('at rotation 180 sets rotation to 180', () => {
      expect(applyVisualMirror(t(180), 'h')).toEqual(t(180, true));
    });

    it('at rotation 270 sets rotation to 90', () => {
      expect(applyVisualMirror(t(270), 'h')).toEqual(t(90, true));
    });

    it('does not affect mirrorV', () => {
      expect(applyVisualMirror(t(90, false, true), 'h')).toEqual(t(270, true, true));
    });
  });

  describe('mirror V', () => {
    it('at rotation 0 only toggles mirrorV', () => {
      expect(applyVisualMirror(t(0), 'v')).toEqual(t(0, false, true));
    });

    it('at rotation 90 sets rotation to 270', () => {
      expect(applyVisualMirror(t(90), 'v')).toEqual(t(270, false, true));
    });

    it('does not affect mirrorH', () => {
      expect(applyVisualMirror(t(90, true), 'v')).toEqual(t(270, true, true));
    });
  });

  describe('double mirror is identity', () => {
    for (const rot of [0, 90, 180, 270] as const) {
      it(`mirror H twice at rotation ${rot}`, () => {
        const original = t(rot, false, true);
        expect(applyVisualMirror(applyVisualMirror(original, 'h'), 'h')).toEqual(original);
      });

      it(`mirror V twice at rotation ${rot}`, () => {
        const original = t(rot, true, false);
        expect(applyVisualMirror(applyVisualMirror(original, 'v'), 'v')).toEqual(original);
      });
    }
  });
});
