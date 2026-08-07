// The left-edge quick-action column (GridQuickActionPanel). It can't be
// imported here — it pulls in @expo/vector-icons, which has no node shim — so,
// like panelTheme.test.ts, the contract is pinned at the source: the capsule
// ORDER (view settings → grid snap → finer → coarser), the snap capsule's
// on/off dressing, and the fact that both optional groups stay gated on their
// callbacks so an app that omits them still gets a bare gear.
import { readFileSync } from 'fs';
import { join } from 'path';
import { CAPSULE_BG, HEADER_INK, STATE_ACTIVE, WHITE_40, WHITE_60 } from '@/editor-ui/theme';
import type { GridViewModel } from '@/editor-ui/adapter';

const SRC = readFileSync(
  join(__dirname, '..', 'components', 'GridQuickActionPanel.tsx'),
  'utf8',
);

/** Where each capsule's label appears in the source — the column paints in
 *  source order, so these positions ARE the top-to-bottom order. */
const at = (needle: string) => {
  const i = SRC.indexOf(needle);
  expect([needle, i >= 0]).toEqual([needle, true]);
  return i;
};

describe('GridQuickActionPanel capsule order', () => {
  it('leads with grid snap, then the grid-level pair', () => {
    expect(at('grid snap')).toBeLessThan(at('Finer grid'));
    expect(at('Finer grid')).toBeLessThan(at('Coarser grid'));
  });

  it('has no view-settings gear', () => {
    // CozyJournal's view preferences are app-wide and live on its native
    // settings screen; there is no page-local sheet for a gear to open.
    expect(SRC).not.toContain('onOpenViewSettings');
    expect(SRC).not.toContain('tune-variant');
  });
});

describe('grid snap capsule', () => {
  it('is the shared CapsuleButton, not a bespoke shape', () => {
    // One button component for the whole column: if the snap capsule ever
    // grows its own <Pressable> it has drifted off the capsule styling.
    expect(SRC.match(/<CapsuleButton/g)?.length).toBe(3);
    expect(SRC).not.toMatch(/<Pressable/);
  });

  it('keeps one plain magnet glyph — the inversion carries the state', () => {
    expect(SRC).toContain(`icon="magnet"`);
    // Not the bolt-throwing variant: with the capsule inverting behind it a
    // second on-cue in the glyph is noise.
    expect(SRC).not.toContain('magnet-on');
  });

  it('inverts when on: accent fill, dark icon and border', () => {
    expect(SRC).toContain(`snapOn ? STATE_ACTIVE : CAPSULE_BG`);
    expect(SRC).toContain(`snapOn ? HEADER_INK : WHITE_60`);
    expect(SRC).toContain(`snapOn ? HEADER_INK : WHITE_40`);
  });

  it('rests in the ordinary capsule colors when off', () => {
    // The tokens themselves, so a theme edit can't quietly unblue the toggle
    // or leave the inverted state light-on-light.
    expect(CAPSULE_BG).toBe('#111111');
    expect(WHITE_60).toBe('rgba(255, 255, 255, 0.6)');
    expect(WHITE_40).toBe('rgba(255, 255, 255, 0.4)');
  });

  it('fills in the same blue the toolbar marks an active tool with', () => {
    expect(STATE_ACTIVE).toBe('#38BDF8');
    // Dark grey on that blue — the toolbar's own ink, not black.
    expect(HEADER_INK).toBe('#2a2a2a');
    expect(HEADER_INK).not.toBe('#000000');
  });

  it('announces which way a press goes', () => {
    expect(SRC).toMatch(/snapOn \? 'Turn grid snap off' : 'Turn grid snap on'/);
  });

  it('renders only when the app supplies onToggleGridSnap', () => {
    expect(SRC).toMatch(/\{onToggleGridSnap \?/);
  });

  it('treats an absent gridSnap as off rather than as on', () => {
    expect(SRC).toMatch(/model\.gridSnap === true/);
  });
});

describe('CapsuleButton fill', () => {
  const BTN = readFileSync(
    join(__dirname, '..', 'components', 'CapsuleButton.tsx'),
    'utf8',
  );

  it('is a prop with one default, not a StyleSheet value plus an override', () => {
    expect(BTN).toMatch(/backgroundColor = CAPSULE_BG/);
    expect(BTN).toMatch(/style=\{\[styles\.button, \{ backgroundColor,/);
    // The StyleSheet must not also set it, or the two can drift apart.
    expect(BTN).not.toMatch(/^\s*backgroundColor: CAPSULE_BG,$/m);
  });
});

describe('GridViewModel', () => {
  it('keeps every capsule optional (an app can take none of them)', () => {
    const empty: GridViewModel = {};
    expect(empty.onToggleGridSnap).toBeUndefined();
    expect(empty.gridSnap).toBeUndefined();
    expect(empty.onSetGridLevel).toBeUndefined();
  });

  it('carries the snap state and its toggle', () => {
    let on = false;
    const full: GridViewModel = {
      gridLevel: 0,
      onSetGridLevel: () => {},
      gridSnap: on,
      onToggleGridSnap: () => { on = !on; },
    };
    full.onToggleGridSnap?.();
    expect(on).toBe(true);
  });
});
