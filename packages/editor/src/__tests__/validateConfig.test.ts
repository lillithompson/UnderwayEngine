import { type HostTool, NO_HOST_TOOLS } from '../hostTools';
import { validateEditorConfig } from '../formats/validateConfig';
import type { CommonEditorConfig, ScaffoldNode } from '../formats/editorConfig';
import { type TestEditorConfig, makeScaffoldConfig } from './test-utils';

// A format config's authoring-time validation (formats/validateConfig.ts):
// one failing case per rule over a made-up app's scaffolded config, plus the
// passing whole.
//
// The host-tool registry is a PARAMETER (each app's own — the seam stage 2
// built), so these pass an empty one except where a dead content mode is the
// thing being checked.

/** Shorthand: the validator over a config, with no host tools of its own. */
const check = (config: Parameters<typeof validateEditorConfig>[0]) =>
  validateEditorConfig(config, NO_HOST_TOOLS);

describe('validateEditorConfig', () => {
  test('realistic haiku config (1 image slot + 3 text slots + matching fillSlot steps + allSlotsFilled) is valid', () => {
    expect(check(makeScaffoldConfig({ canvas: { aspect: 3 / 4 } }))).toEqual([]);
  });

  test('duplicate slotIds', () => {
    const dup: ScaffoldNode = { kind: 'textSlot', slotId: 'line1', hint: '', placeholder: 'x', style: {}, cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2 };
    const config = makeScaffoldConfig();
    const errors = check({ ...config, scaffold: [...config.scaffold, dup] });
    expect(errors).toContain('scaffold: duplicate slotId "line1"');
  });

  test('non-positive slot sizes', () => {
    const config = makeScaffoldConfig({
      scaffold: [
        { kind: 'imageSlot', slotId: 'photo', hint: '', cellX: 0, cellY: 0, cellWidth: 0, cellHeight: 24 },
        { kind: 'textSlot', slotId: 'line1', hint: '', placeholder: 'x', style: {}, cellX: 0, cellY: 0, cellWidth: 4, cellHeight: -2 },
      ],
      promptFlow: [
        { id: 'p1', kind: 'fillSlot', slotId: 'photo', title: '' },
        { id: 'p2', kind: 'fillSlot', slotId: 'line1', title: '' },
      ],
    });
    const errors = check(config);
    expect(errors.filter((e) => e.includes('positive size'))).toHaveLength(2);
  });

  test('fillSlot step referencing an unknown slot', () => {
    const config = makeScaffoldConfig();
    const errors = check({
      ...config,
      promptFlow: [...config.promptFlow, { id: 'p-ghost', kind: 'fillSlot', slotId: 'ghost', title: '' }],
    });
    expect(errors).toContain('promptFlow: step "p-ghost" references unknown slotId "ghost"');
  });

  test('slotsFilled completion referencing an unknown slot', () => {
    const errors = check(
      makeScaffoldConfig({ completion: { kind: 'slotsFilled', slotIds: ['line1', 'ghost'] } }),
    );
    expect(errors).toContain('completion: slotsFilled references unknown slotId "ghost"');
  });

  test('empty tools', () => {
    expect(check(makeScaffoldConfig({ tools: [] }))).toContain('tools: must be non-empty');
  });

  test('non-positive canvas aspect', () => {
    expect(check(makeScaffoldConfig({ canvas: { aspect: 0 } }))).toContain(
      'canvas: aspect must be > 0 (got 0)',
    );
    expect(check(makeScaffoldConfig({ canvas: { aspect: -1 } }))).not.toEqual([]);
  });

  test('scaffold slot with no fillSlot step fails under slot-based completion', () => {
    const config = makeScaffoldConfig({
      promptFlow: makeScaffoldConfig().promptFlow.filter(
        (s) => !(s.kind === 'fillSlot' && s.slotId === 'line3'),
      ),
    });
    expect(check(config)).toContain(
      'promptFlow: scaffold slot "line3" has no fillSlot step',
    );
  });

  test("…but is waived when completion is 'anyEdit'", () => {
    const config: TestEditorConfig = makeScaffoldConfig({
      completion: { kind: 'anyEdit' },
      promptFlow: [{ id: 'p-free', kind: 'free' }],
    });
    expect(check(config)).toEqual([]);
  });

  test('a frame that joins slots it has not got, and decor that joins no frame', () => {
    const config = makeScaffoldConfig({
      frame: { cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 24, memberSlotIds: ['photo', 'ghost'] },
      decorTexts: [
        { decorId: 'a', content: 'x', style: {}, cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2 },
        { decorId: 'a', content: 'y', style: {}, cellX: 0, cellY: 0, cellWidth: 0, cellHeight: 2 },
      ],
    });
    const errors = check(config);
    expect(errors).toContain('frame: memberSlotIds references unknown slotId "ghost"');
    expect(errors).toContain('decorTexts: duplicate decorId "a"');
    expect(errors.some((e) => e.includes('"a" must have positive size'))).toBe(true);
    // …and inFrame on a config with no frame at all.
    const noFrame = makeScaffoldConfig({
      decorTexts: [{ decorId: 'b', content: 'x', style: {}, inFrame: true, cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2 }],
    });
    expect(check(noFrame)).toContain(
      'decorTexts: "b" sets inFrame but the format declares no frame',
    );
  });
});

describe('a content mode granted by a flag and then left out of the list', () => {
  // The flag grants nothing, and the loss runs wider than the pushdown — the
  // Tile mode is also what tells a format that shapes may wear a pattern
  // fill. Read off the app's own registry, which is why it is a parameter.
  const PLACERS: readonly HostTool[] = [
    { id: 'leaf', label: 'Leaf', icon: 'leaf', contentMode: { gate: 'leafTool' } },
    { id: 'bloom', label: 'Bloom', icon: 'flower', contentMode: { gate: 'bloomTool' } },
  ];

  test('is named, and only for the modes the registry actually gates', () => {
    const config = { ...makeScaffoldConfig(), contentTools: ['image', 'text', 'leaf'], leafTool: true, bloomTool: true };
    const errors = validateEditorConfig(config, PLACERS);
    expect(errors).toContain(
      'contentTools: "bloom" is turned on by its flag but not listed, so the flag does nothing',
    );
    expect(errors.some((e) => e.includes('"leaf"'))).toBe(false);
  });

  test('…and nothing is dead when the app has no such tools at all', () => {
    const config = { ...makeScaffoldConfig(), contentTools: ['image', 'text'], leafTool: true };
    expect(validateEditorConfig(config, NO_HOST_TOOLS)).toEqual([]);
  });
});

describe('a config with NO format layer, which is Sol’s shape', () => {
  // The reason the validator takes the layer as a `Partial` (see the
  // module header): Sol's config declares no scaffold, no prompt flow and
  // no completion rule, and its own copy of this file was these checks with
  // every scaffold one deleted. Taking it as optional makes them VACUOUS
  // rather than absent — one function, nothing to keep in sync.
  const bare: CommonEditorConfig = { formatId: 'blank', canvas: { aspect: 1 }, tools: ['arrange', 'draw'] };

  test('passes, and every scaffold check is simply not asked', () => {
    expect(check(bare)).toEqual([]);
  });

  test('…while the two checks that are about the common half still fire', () => {
    expect(check({ ...bare, tools: [] })).toContain('tools: must be non-empty');
    expect(check({ ...bare, canvas: { aspect: 0 } })).toContain('canvas: aspect must be > 0 (got 0)');
  });

  test('a completion rule with no scaffold is not held to one', () => {
    // `allSlotsFilled` over no slots asks for nothing, rather than crashing
    // on an undefined scaffold — which is what an unguarded `.map` did.
    expect(check({ ...bare, completion: { kind: 'allSlotsFilled' } })).toEqual([]);
    expect(check({ ...bare, completion: { kind: 'slotsFilled', slotIds: ['ghost'] } }))
      .toContain('completion: slotsFilled references unknown slotId "ghost"');
  });
});
