import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  PATTERN_EDIT_OPTIONS,
  PATTERN_GRID_ACTIONS,
  PATTERN_SYMMETRY_ENTRIES,
  PATTERN_SYMMETRY_FLAGS_OFF,
  groupPatternTiles,
  patternActionOfSubmenu,
  patternActionSubmenu,
  patternSymmetryForKey,
  patternSymmetryKey,
} from '../logic/patternEdit';
import { submenuHeight } from '../logic/submenuHeight';

describe('the pattern options row', () => {
  it('offers Tiles, Tools and Symmetry, in that order', () => {
    expect(PATTERN_EDIT_OPTIONS.map((o) => o.action)).toEqual(['tiles', 'tools', 'symmetry']);
    for (const o of PATTERN_EDIT_OPTIONS) expect(o.label.length).toBeGreaterThan(0);
  });

  it('the Tools bar runs Flood, Reconcile and Clear on the grid', () => {
    expect(PATTERN_GRID_ACTIONS.map((a) => a.action)).toEqual(['flood', 'reconcile', 'clear']);
  });

  it('maps each action to its submenu key and back', () => {
    for (const o of PATTERN_EDIT_OPTIONS) {
      const sub = patternActionSubmenu(o.action);
      expect(patternActionOfSubmenu(sub)).toBe(o.action);
      // Every pattern bar has a height — the exhaustiveness guard would
      // make a missing case a compile error, but a zero would stunt it.
      expect(submenuHeight(sub)).toBeGreaterThan(0);
    }
    expect(patternActionOfSubmenu('shadow')).toBeNull();
  });
});

describe('the symmetry grid', () => {
  it('carries the 11 modes of the old modal, each an exclusive flag set', () => {
    expect(PATTERN_SYMMETRY_ENTRIES.map((e) => e.key)).toEqual(
      ['h', 'v', 'hv', 'd1', 'd2', 'dx', 'row', 'col', 'quad', 'rot', 'star'],
    );
    for (const e of PATTERN_SYMMETRY_ENTRIES) {
      const litFlags = Object.values(e.flags).filter(Boolean).length;
      // Exactly one mode's flags — H+V is the one two-flag entry.
      expect(litFlags).toBe(e.key === 'hv' ? 2 : 1);
    }
  });

  it('round-trips key ↔ flags, with off as the empty set', () => {
    for (const e of PATTERN_SYMMETRY_ENTRIES) {
      expect(patternSymmetryKey(patternSymmetryForKey(e.key))).toBe(e.key);
    }
    expect(patternSymmetryForKey('off')).toBeUndefined();
    expect(patternSymmetryKey(undefined)).toBe('off');
    expect(patternSymmetryKey(PATTERN_SYMMETRY_FLAGS_OFF)).toBe('off');
  });

  it('reads an unknown flag combination as off rather than mislabeling it', () => {
    expect(patternSymmetryKey({ ...PATTERN_SYMMETRY_FLAGS_OFF, mirrorH: true, mirrorStar: true }))
      .toBe('off');
  });
});

// No test renderer for the panel component, so its flag-enumeration sites
// are pinned by source — the bug this guards: showPatternOptions had a
// typeSpecs branch but was missing from `hasTypeOptions`, so the type page
// carrying Tiles / Tools / Symmetry was never offered for a pattern
// selection.
describe('the panel offers the pattern type page', () => {
  const SRC = readFileSync(
    resolve(__dirname, '..', 'components', 'ObjectPropertiesPanel.tsx'), 'utf8',
  );

  it('counts showPatternOptions into hasTypeOptions and the type signature', () => {
    const hasTypeOptions = SRC.slice(
      SRC.indexOf('const hasTypeOptions ='),
      SRC.indexOf('const hasMultiOptions ='),
    );
    expect(hasTypeOptions).toContain('model.showPatternOptions');
    const typeSig = SRC.slice(SRC.indexOf('const typeSig ='), SRC.indexOf('const prevTypeSig'));
    expect(typeSig).toContain('showPatternOptions');
  });

  it('lets a pattern selection keep the Stroke bar open', () => {
    // The fold-away guard closes strokeOpen when the selection stops
    // offering the bar. It must count patterns as offering it — the bug
    // this pins: the guard knew only showSvgOptions, so opening Stroke on
    // a pattern was immediately folded away and the previously open
    // pattern bar snapped back.
    const guard = SRC.slice(
      SRC.indexOf('const strokeable ='),
      SRC.indexOf('if ((!model.visible || !svgFillable)'),
    );
    expect(guard).toContain('model.showPatternOptions');
    expect(guard).toContain('if ((!model.visible || !strokeable) && model.strokeOpen)');
  });

  it('builds the pattern typeSpecs branch, with the shared Stroke bar', () => {
    expect(SRC).toContain('else if (model.showPatternOptions) {');
    const order = SRC.slice(
      SRC.indexOf('const typeSubmenuOrder'),
      SRC.indexOf('const submenuOrder'),
    );
    // The pattern's pages plus the vectors' Stroke bar ride the carousel.
    expect(order).toContain('model.showPatternOptions');
    expect(order).toContain("'stroke' as const");
  });
});

describe('the tile menu grouping', () => {
  it('sections by connection count, ascending, skipping empty counts', () => {
    const tiles = [
      { id: 'a/tile_11111111', connections: 8, uri: 'u1' },
      { id: 'a/tile_00000000', connections: 0, uri: 'u2' },
      { id: 'a/tile_10101010', connections: 4, uri: 'u3' },
      { id: 'b/tile_01010101', connections: 4, uri: 'u4' },
    ];
    const groups = groupPatternTiles(tiles);
    expect(groups.map((g) => g.connections)).toEqual([0, 4, 8]);
    expect(groups[1].tiles.map((t) => t.id)).toEqual(['a/tile_10101010', 'b/tile_01010101']);
  });

  it('is empty for an empty menu', () => {
    expect(groupPatternTiles([])).toEqual([]);
  });
});
