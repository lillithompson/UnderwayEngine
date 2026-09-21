/**
 * The EFFECTS page and the tabs it makes.
 *
 * It is the one page in the Edit sheet whose USE changes the row above it.
 * Every other tab is a fixed property of the selection's kind; these three
 * buttons add and remove tabs as they add and remove the effects they stand
 * for — a press puts a tab on the row and opens it, another press takes it
 * away again. So most of what these pin is that the row, the pages the sheet
 * may open, and the buttons' lit state are all read from ONE answer (which
 * effects the selection wears), and that the sheet can't be left showing a
 * tab that has gone.
 *
 * The three effects themselves share one set of rows: a glow is a shadow
 * with nowhere to fall, so its page is the shadow's page without the offset
 * pad, and the two measure the same.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { IMAGE_EDIT_OPTIONS } from '../logic/imageEdit';
import { svgEditOptions } from '../logic/svgEdit';
import {
  BAR_CUSHION, ROW_SEGMENTED, pageIsWelled, submenuHeight,
} from '../logic/submenuHeight';

const SRC = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8');
const PANEL = read('components', 'ObjectPropertiesPanel.tsx');
const BAR = read('components', 'EffectsBar.tsx');
const ADAPTER = read('adapter.ts');

describe('the tab is Effects, on every kind that can cast one', () => {
  it('the image and vector option menus name it', () => {
    expect(IMAGE_EDIT_OPTIONS.find((o) => o.action === 'effects')?.label).toBe('Effects');
    expect(IMAGE_EDIT_OPTIONS.some((o) => (o.action as string) === 'shadow')).toBe(false);
    const line = svgEditOptions('line');
    expect(line.find((o) => o.action === 'effects')?.label).toBe('Effects');
    expect(line.some((o) => (o.action as string) === 'shadow')).toBe(false);
  });

  it('every kind grows its effect tabs through ONE builder', () => {
    // The row and the pages the sheet may open have to agree — a tab that
    // opens nothing, or a page with no tab, is the bug this shape prevents.
    expect(PANEL).toContain('const effectSpecs = (): OptionSpec[] => [');
    expect(PANEL).toContain(
      "const effectPages: SubmenuKey[] = ['effects', ...wornEffects.map((k) => EFFECT_PAGE[k])];",
    );
    // Four hand-written rows (frame · sticker · text) and the two built from
    // option menus (image · vector) all spread the same run.
    expect(PANEL.match(/\.\.\.effectSpecs\(\)/g)).toHaveLength(3);
    expect(PANEL.match(/\.\.\.effectPages/g)).toHaveLength(6);
    expect(PANEL).toContain("opt.action === 'effects' ? effectSpecs() : [{");
    // No kind spells the tab out for itself: the one literal is the
    // builder's own.
    expect(PANEL.match(/\{ key: 'effects', label: 'Effects', sub: 'effects', onPress/g))
      .toHaveLength(1);
  });
});

describe('three buttons, and the tabs they make', () => {
  it('the page is one row of them, in the shape every page’s one act wears', () => {
    expect(BAR).toContain('<EffectButtonRow>');
    expect(BAR).toContain('layout="column"');
    expect(BAR).toContain('label={effectLabel(kind)}');
    // A plus to add, a check to say it is already there.
    expect(BAR).toContain("icon={on ? 'check' : 'plus'}");
    expect(BAR).toContain('active={on}');
    // …and it reads as what a press will DO, whichever way it points.
    expect(BAR).toContain("accessibilityLabel={`${on ? 'Remove' : 'Add'} ${effectLabel(kind)}`}");
    expect(BAR).toContain('onPress={() => onToggle(kind, !on)}');
    // One row, drawn BARE — no well behind it: three buttons are not a
    // field of controls for a grey slab to gather.
    expect(pageIsWelled('effects')).toBe(false);
    expect(submenuHeight('effects')).toBe(ROW_SEGMENTED + BAR_CUSHION);
    // Three across is a third of the well each, so the column style buys
    // back the points the words need — "Outer Glow" at the block button's
    // own measure lands within a point or two of the space it has.
    const eb = read('components', 'effectBar.tsx');
    expect(eb).toContain('addButtonColumn: { gap: 4, borderWidth: 1, borderColor: PANEL_BORDER },');
    expect(eb).toContain('addLabelColumn: { fontSize: 13 },');
    expect(eb).toContain("buttonRow: { height: ROW_SEGMENTED, flexDirection: 'row', gap: 6 },");
    // …and a toggled one fills in DARK GREY, not the blue a lit tab wears:
    // these say "this effect is on the object", not "this is the page
    // you're looking at", and in the same blue the row read as a second row
    // of tabs.
    expect(eb).toContain('addButtonActive: { backgroundColor: PANEL_CONTROL_ON },');
    expect(eb).not.toContain('addButtonActive: { backgroundColor: STATE_ACTIVE },');
  });

  it('a tab exists exactly while its effect is worn — read STRICTLY', () => {
    // `!== false` is the absent-effect Add pages' rule and it is wrong here:
    // those fall back to showing controls, which is harmless, where this
    // would conjure a TAB — a place to go — for an effect a host that
    // reports nothing may not have.
    expect(PANEL).toContain("const effectWorn = (kind: EffectKind): boolean => (kind === 'shadow'");
    expect(PANEL).toContain('? model.shadowPresent === true');
    expect(PANEL).toContain(': model.glowPresent?.[kind] === true);');
    expect(PANEL).toContain('const wornEffects = EFFECT_KINDS.filter(effectWorn);');
    // The buttons light off that same answer, so a lit button and a standing
    // tab cannot disagree.
    expect(PANEL).toContain('<EffectsBar present={effectWorn} onToggle={toggleEffect} />');
  });

  it('adding opens the new tab at once', () => {
    const fn = PANEL.slice(
      PANEL.indexOf('const toggleEffect = (kind: EffectKind, add: boolean) => {'),
      PANEL.indexOf('\n  // Border controls'),
    );
    expect(fn).toContain('if (!add) { removeEffect(kind); return; }');
    expect(fn).toContain('model.onAddShadow?.();');
    expect(fn).toContain('model.onAddGlow?.(kind);');
    expect(fn).toContain('openSubmenu(EFFECT_PAGE[kind]);');
    // The draft seeded on the ABSENT effect is dropped on the way, so the
    // controls that come up read the freshly created one off the model.
    expect(fn).toContain('setShadowDraft(null);');
    expect(fn).toContain('setGlowDrafts((d) => ({ ...d, [kind]: undefined }));');
  });

  it('removing works from either place, and lands back on Effects', () => {
    // Toggling the lit button off IS the Remove line's press…
    expect(PANEL).toContain('if (!add) { removeEffect(kind); return; }');
    // …and the effect's own page carries that line too.
    expect(PANEL).toContain('label: `Remove ${effectLabel(shownEffect).toLowerCase()}`,');
    expect(PANEL).toContain('onPress: () => removeEffect(shownEffect),');
    const fn = PANEL.slice(
      PANEL.indexOf('const removeEffect = (kind: EffectKind) => {'),
      PANEL.indexOf('/** The Effects page’s buttons'),
    );
    expect(fn).toContain("if (kind === 'shadow') model.onShadow?.(null, true);");
    expect(fn).toContain('else model.onGlow?.(kind, null, true);');
    // The tab it was edited on is about to go, so the sheet moves to the
    // page that makes them rather than being left on nothing.
    expect(fn).toContain("setEffectsPage('effects');");
  });

  it('…and a tab that goes any OTHER way lands there too', () => {
    // The shared landing rule would drop the sheet on the row's first tab —
    // for an image, Crop, nowhere near what was being worked on.
    expect(PANEL).toContain('const target = last && EFFECT_OF_PAGE[last] && !submenuOrder.includes(last)');
    expect(PANEL).toContain("? ('effects' as SubmenuKey)");
  });
});

describe('the four pages ride one host flag', () => {
  it('the page state picks between them, as the text pages do', () => {
    expect(PANEL).toContain("const [effectsPage, setEffectsPage] = useState<SubmenuKey>('effects');");
    expect(PANEL).toContain(': model.effectsOpen ? effectsPage');
    expect(PANEL).toContain("else if (key === 'effects' || EFFECT_OF_PAGE[key]) {");
    expect(PANEL).toContain('setEffectsPage(key);');
    expect(ADAPTER).toContain('effectsOpen?: boolean;');
    expect(ADAPTER).toContain('onEffectsOpenChange?(open: boolean): void;');
    // The old single-effect names are gone, so no host can half-migrate.
    expect(ADAPTER).not.toContain('shadowOpen?: boolean;');
    expect(ADAPTER).not.toContain('onShadowOpenChange');
  });

  it('one map says which page an effect opens, and which effect a page is for', () => {
    expect(PANEL).toContain("shadow: 'shadow', outer: 'glowOuter', inner: 'glowInner',");
    expect(PANEL).toContain("shadow: 'shadow', glowOuter: 'outer', glowInner: 'inner',");
  });
});

describe('an effect’s own page', () => {
  it('is one set of rows — only the shadow brings the offset pad', () => {
    expect(BAR.match(/<SliderRow/g)).toHaveLength(3);
    expect(BAR).toContain('label="Blur"');
    expect(BAR).toContain('label="Spread"');
    expect(BAR).toContain('label="Opacity"');
    expect(BAR).toContain('aside={directional ? (');
    expect(PANEL).toContain("directional={shownEffect === 'shadow'}");
    // One pad in the file, so a glow's page cannot grow a second one.
    expect(BAR.match(/<XYPad/g)).toHaveLength(1);
  });

  it('…and so the three stand at exactly the same height', () => {
    // The pad is as tall as the three sliders beside it, so taking it away
    // costs nothing: the sheet never moves between the effect tabs.
    expect(submenuHeight('glowOuter')).toBe(submenuHeight('shadow'));
    expect(submenuHeight('glowInner')).toBe(submenuHeight('shadow'));
    expect(submenuHeight('glowOuter', { effectColor: true }))
      .toBe(submenuHeight('shadow', { effectColor: true }));
  });

  it('writes through the effect it is showing, and zeroes a glow’s offset', () => {
    expect(PANEL).toContain("if (effectKind === 'shadow') { applyShadow(s, committed); return; }");
    expect(PANEL).toContain('const { dx: _dx, dy: _dy, ...glow } = s;');
    expect(PANEL).toContain('applyGlow(effectKind, glow, committed);');
    // …and reads it back the same way, with the pad's two numbers stood at
    // zero rather than carried over from the shadow.
    expect(PANEL).toContain('return { ...g, dx: 0, dy: 0 };');
  });

  it('each effect’s colour row writes where that effect’s picker writes', () => {
    expect(PANEL).toContain('? (color, committed) => (glowKind');
    expect(PANEL).toContain('? model.onGlowColor?.(glowKind, color, committed)');
    expect(PANEL).toContain(': model.onShadowColor?.(color, committed))');
    expect(PANEL).toContain('? () => (glowKind ? model.onPickGlowColor?.(glowKind) : model.onPickShadowColor?.())');
  });
});

describe('the glows ride one kind-taking callback each', () => {
  it('the adapter names them by kind rather than twice over', () => {
    for (const decl of [
      "export type GlowKind = 'outer' | 'inner';",
      'glows?: Partial<Record<GlowKind, GlowModel>>;',
      'glowPresent?: Partial<Record<GlowKind, boolean>>;',
      'onAddGlow?(kind: GlowKind): void;',
      'onGlow?(kind: GlowKind, glow: GlowModel | null, committed: boolean): void;',
      'onGlowColor?(kind: GlowKind, color: RGBLike, committed: boolean): void;',
      'onPickGlowColor?(kind: GlowKind): void;',
    ]) {
      expect([decl, ADAPTER.includes(decl)]).toEqual([decl, true]);
    }
    // A shadow IS a glow with an offset, so the model says so rather than
    // repeating the four fields.
    expect(ADAPTER).toContain('export interface ShadowModel extends GlowModel {');
  });
});
