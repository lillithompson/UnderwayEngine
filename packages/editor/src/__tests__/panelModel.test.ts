import { makeBlankComposition } from '../blankComposition';
import {
  buildGroupSelectedMulti,
  buildPlaceImage,
  buildPlaceLineShape,
  buildPlaceShape,
  buildPlaceText,
  buildToggleLock,
  commitEntry,
  createEditorSession,
  select,
  selectMany,
  type EditorSession,
} from '../editorSession';
import {
  buildPanelFacts,
  buildPanelModel,
  editTargetIds,
  effectTargetIds,
  foldTargets,
  isRepeatTarget,
  svgEnclosesRef,
  type PanelFactsInput,
  type PanelHandlers,
  type PanelModelInput,
  type PanelPages,
  type PanelPatternState,
} from '../panelModel';
import { clearSessionHost, installSessionHost, type SessionHost } from '../sessionHost';
import { findItem } from '@/engine/compositionOps';
import type { RGBColor, TextObject } from '@/engine/types';

// The shared object-properties panel's model: what the selection is
// (buildPanelFacts) and which pages it may open (buildPanelModel). The
// three shells each built this by hand; their own pins — what each shell
// wires to the result — stay in each app.

const INK: RGBColor = { r: 40, g: 40, b: 40 };
const WHITE: RGBColor = { r: 255, g: 255, b: 255 };

function populated() {
  let session = createEditorSession(makeBlankComposition('c1'));
  const shape = buildPlaceShape('rect', { cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 }, INK);
  session = commitEntry(session, shape);
  const line = buildPlaceLineShape([0, 8], [6, 8], INK, 'line', 0)!;
  session = commitEntry(session, line);
  const text = buildPlaceText('Once upon a time', { fontId: 'system', size: 2, color: INK }, 8, 8);
  session = commitEntry(session, text);
  const image = buildPlaceImage('img1', 'image/png', 50, 50,
    { cellX: 2, cellY: 2, cellWidth: 4, cellHeight: 4 }, new Uint8Array([1]), { name: 'Sunset' });
  session = commitEntry(session, image);
  return {
    // Nothing selected: the last commit selects what it placed, and most
    // of what follows is about a selection it makes itself.
    session: select(session, null),
    shapeId: shape.id!, lineId: line.id!, textId: text.id!, imageId: image.id!,
  };
}

const FACTS_FLAGS: Omit<PanelFactsInput, 'session'> = {
  currentColor: INK,
  fadeTarget: WHITE,
  brushArmed: false,
  cropOpen: false,
  editingImageId: null,
  editablePatternId: null,
};

const factsOf = (
  session: EditorSession | null,
  over: Partial<Omit<PanelFactsInput, 'session'>> = {},
) =>
  buildPanelFacts({ session, ...FACTS_FLAGS, ...over });

const PAGES: PanelPages = {
  editOpen: false,
  effectsOpen: false,
  borderOpen: false,
  cropOpen: false,
  strokeOpen: false,
  svgFillOpen: false,
  svgPatternOpen: false,
  endpointsOpen: false,
  transformOpen: false,
  textStyleOpen: false,
  opacityOpen: false,
  patternBarOpen: null,
};

const PATTERN: PanelPatternState = {
  patternTiles: [],
  patternRecent: [],
  patternSubTool: { kind: 'random' },
  patternTileTransforms: {},
  patternEnabledSets: new Set<string>(),
};

/** Every handler, each recording that it was the one called. */
function handlers(): PanelHandlers & { calls: string[] } {
  const calls: string[] = [];
  const fn = (name: string) => () => { calls.push(name); };
  return {
    calls,
    onEditOpenChange: fn('onEditOpenChange'),
    onCornerRadius: fn('onCornerRadius'),
    onEffectsOpenChange: fn('onEffectsOpenChange'),
    onAddShadow: fn('onAddShadow'),
    onShadow: fn('onShadow'),
    onPickShadowColor: fn('onPickShadowColor'),
    onShadowColor: fn('onShadowColor'),
    onAddGlow: fn('onAddGlow'),
    onGlow: fn('onGlow'),
    onPickGlowColor: fn('onPickGlowColor'),
    onGlowColor: fn('onGlowColor'),
    onToggleImageTint: fn('onToggleImageTint'),
    onAddBorder: fn('onAddBorder'),
    onBorderOpenChange: fn('onBorderOpenChange'),
    onBorder: fn('onBorder'),
    onPickBorderColor: fn('onPickBorderColor'),
    onBorderColor: fn('onBorderColor'),
    onCropOpenChange: fn('onCropOpenChange'),
    onFraming: fn('onFraming'),
    onResetFraming: fn('onResetFraming'),
    onReplaceImageSource: fn('onReplaceImageSource'),
    onAddStroke: fn('onAddStroke'),
    onStrokeOpenChange: fn('onStrokeOpenChange'),
    onStroke: fn('onStroke'),
    onStrokeRadius: fn('onStrokeRadius'),
    onPickStrokeColor: fn('onPickStrokeColor'),
    onStrokeColor: fn('onStrokeColor'),
    onAddSvgFill: fn('onAddSvgFill'),
    onSvgFillOpenChange: fn('onSvgFillOpenChange'),
    onSvgFill: fn('onSvgFill'),
    onPickSvgFillColor: fn('onPickSvgFillColor'),
    onSvgFillColor: fn('onSvgFillColor'),
    onSvgPatternOpenChange: fn('onSvgPatternOpenChange'),
    onSvgPatternSize: fn('onSvgPatternSize'),
    onSvgPatternSpan: fn('onSvgPatternSpan'),
    onSvgPatternStroke: fn('onSvgPatternStroke'),
    onPickSvgPatternStrokeColor: fn('onPickSvgPatternStrokeColor'),
    onSvgPatternSymmetry: fn('onSvgPatternSymmetry'),
    onSvgPatternToggleTileSet: fn('onSvgPatternToggleTileSet'),
    onAddSvgPattern: fn('onAddSvgPattern'),
    onEditSvgPattern: fn('onEditSvgPattern'),
    onRemoveSvgPattern: fn('onRemoveSvgPattern'),
    onEndpointsOpenChange: fn('onEndpointsOpenChange'),
    onEndpoints: fn('onEndpoints'),
    onTransformOpenChange: fn('onTransformOpenChange'),
    onTransformCopies: fn('onTransformCopies'),
    onTransformCopiesPreview: fn('onTransformCopiesPreview'),
    onCopiesSticky: fn('onCopiesSticky'),
    onPatternBarOpenChange: fn('onPatternBarOpenChange'),
    onPatternSymmetry: fn('onPatternSymmetry'),
    onPatternPickTile: fn('onPatternPickTile'),
    onPatternSetTileTransform: fn('onPatternSetTileTransform'),
    onPatternArmTool: fn('onPatternArmTool'),
    onPatternMakeColorable: fn('onPatternMakeColorable'),
    onPatternGridAction: fn('onPatternGridAction'),
    onPatternToggleBorder: fn('onPatternToggleBorder'),
    onPatternToggleTileSet: fn('onPatternToggleTileSet'),
    onTogglePatternRepeat: fn('onTogglePatternRepeat'),
    onOpacityOpenChange: fn('onOpacityOpenChange'),
    onObjectOpacity: fn('onObjectOpacity'),
    onPickFadeColor: fn('onPickFadeColor'),
    onTextStyleOpenChange: fn('onTextStyleOpenChange'),
    onTextStyle: fn('onTextStyle'),
    onPickTextColor: fn('onPickTextColor'),
    onTextColor: fn('onTextColor'),
    onResetTextStyle: fn('onResetTextStyle'),
    onPickFrameBackground: fn('onPickFrameBackground'),
    onFrameBackgroundColor: fn('onFrameBackgroundColor'),
    onUngroupFrame: fn('onUngroupFrame'),
    onRotate: fn('onRotate'),
    onMirror: (axis) => { calls.push(`onMirror:${axis}`); },
    onDuplicate: fn('onDuplicate'),
    onToggleLock: fn('onToggleLock'),
    onDelete: fn('onDelete'),
    onInvert: fn('onInvert'),
  };
}

function modelOf(
  session: EditorSession,
  over: Partial<PanelModelInput> = {},
  flags: Partial<Omit<PanelFactsInput, 'session'>> = {},
) {
  const h = over.handlers ?? handlers();
  return buildPanelModel({
    session,
    facts: over.facts ?? factsOf(session, flags),
    pages: { ...PAGES, ...(over.pages ?? {}) },
    pattern: PATTERN,
    visible: true,
    safeTop: 90,
    shapePatternFills: true,
    fonts: [],
    copiesSticky: {},
    currentColor: INK,
    svgFillSelectedStop: 0,
    defaultFrameBackground: WHITE,
    ...over,
    handlers: h,
  } as PanelModelInput);
}

beforeEach(() => clearSessionHost());
afterEach(() => clearSessionHost());

describe('the panel’s target ids', () => {
  test('a leaf is its own target; a multi-selection is every member', () => {
    const { session, shapeId, textId } = populated();
    expect(editTargetIds(select(session, shapeId))).toEqual([shapeId]);
    expect(editTargetIds(selectMany(session, [shapeId, textId]))).toEqual([shapeId, textId]);
    expect(editTargetIds(session)).toEqual([]);
  });

  test('a FRAME is not a leaf: the edit targets are empty, the effect target is its boundary', () => {
    const { session, shapeId, textId } = populated();
    const grouped = commitEntry(session, buildGroupSelectedMulti(session.state, [shapeId, textId])!);
    const gid = grouped.state.groups[0].id;
    const framed = {
      ...grouped,
      state: {
        ...grouped.state,
        groups: grouped.state.groups.map((g) => ({ ...g, isFrame: g.id === gid })),
      },
    } as EditorSession;
    const s = select(framed, gid);
    expect(editTargetIds(s)).toEqual([]);
    // No boundary rect on this made-up frame, so nothing effect-capable.
    expect(effectTargetIds(s)).toEqual([]);
  });

  test('foldTargets folds the per-node transform in order', () => {
    const { session, shapeId, lineId } = populated();
    const seen: string[] = [];
    const out = foldTargets(session.state, [shapeId, lineId], (st, id) => { seen.push(id); return st; });
    expect(seen).toEqual([shapeId, lineId]);
    expect(out).toBe(session.state);
  });
});

describe('buildPanelFacts', () => {
  test('a single image: the image row, its Effects host, no vector pages', () => {
    const { session, imageId } = populated();
    const f = factsOf(select(session, imageId));
    expect(f.multiIds).toBeNull();
    expect(f.selected?.kind).toBe('image');
    expect(f.imageEditable).toBe(true);
    expect(f.svgEditable).toBe(false);
    expect(f.textStyleEditable).toBe(false);
    expect(f.effectsHost).not.toBeNull();
    expect(f.objectOpacity?.opacity).toBe(1);
    // A photograph has no one ink to ramp from.
    expect(f.objectOpacity?.fadeInk).toBeUndefined();
  });

  test('a LOCKED node offers no type row at all', () => {
    const { session, imageId } = populated();
    const locked = commitEntry(session, buildToggleLock(session.state, imageId)!);
    const f = factsOf(select(locked, imageId));
    expect(f.imageEditable).toBe(false);
    expect(f.targetRefs).toHaveLength(1);
  });

  test('a text keeps its fade pair on its style, and a sticker reads its invert', () => {
    const { session, textId } = populated();
    const f = factsOf(select(session, textId));
    expect(f.textStyleEditable).toBe(true);
    expect(f.stickerEditable).toBe(false);
    expect(f.objectOpacity?.fadeInk).toEqual(INK);

    const sticker = {
      ...session,
      state: {
        ...session.state,
        texts: session.state.texts!.map((t): TextObject => (
          t.id === textId ? { ...t, sticker: true, invert: true } : t
        )),
      },
    } as EditorSession;
    const sf = factsOf(select(sticker, textId));
    expect(sf.stickerEditable).toBe(true);
    expect(sf.stickerInverted).toBe(true);
    expect(sf.textStyleEditable).toBe(false);
  });

  test('a mixed multi-selection shares only the pages every member can open', () => {
    const { session, shapeId, imageId } = populated();
    const f = factsOf(selectMany(session, [shapeId, imageId]));
    expect(f.multiIds).toEqual([shapeId, imageId]);
    expect(f.svgEditable).toBe(false);
    expect(f.imageEditable).toBe(false);
    // …but Opacity is every kind's, so the page is offered.
    expect(f.multiOpacityEditable).toBe(true);
  });

  test('a mixed vector selection collapses to the base stroke menu but keeps Remove', () => {
    const { session, shapeId, lineId } = populated();
    const f = factsOf(selectMany(session, [shapeId, lineId]));
    expect(f.svgEditable).toBe(true);
    // The rectangle and the line disagree, so the shared MENU is the base one…
    expect(f.sharedSvgSubtype).toBe('stroke');
    // …and removability is asked of the members: a line cannot lose its line.
    expect(f.svgStrokeRemovableAll).toBe(false);
    // A closed shape alone can.
    expect(factsOf(select(session, shapeId)).svgStrokeRemovableAll).toBe(true);
    // Nothing vector in hand leaves the panel on its own reading.
    expect(factsOf(session).svgStrokeRemovableAll).toBeUndefined();
  });

  test('an open path answers nothing about stroke PRESENCE — it is its stroke', () => {
    const { session, shapeId, lineId } = populated();
    expect(factsOf(select(session, lineId)).svgStrokePresent).toBeUndefined();
    expect(factsOf(select(session, shapeId)).svgStrokePresent).toBe(true);
  });

  test('the Copies page stands down over a figure', () => {
    const base = makeBlankComposition('cf');
    const state = {
      ...base,
      figures: [{ id: 'fig1', name: 'Star', cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 } as never],
      sceneOrder: ['fig1'],
    };
    const s = select(createEditorSession(state), 'fig1');
    expect(factsOf(s).transformCopyable).toBe(false);
    expect(factsOf(s).multiOpacityEditable).toBe(false);
  });

  test('an image reframes by double tap only while nothing is gone and no brush is armed', () => {
    const { session, imageId } = populated();
    const s = select(session, imageId);
    expect(factsOf(s, { editingImageId: imageId }).editingImage).toBe(imageId);
    expect(factsOf(s, { editingImageId: imageId }).imageFramingNodeId).toBe(imageId);
    // A brush in hand makes the drag a stroke.
    expect(factsOf(s, { editingImageId: imageId, brushArmed: true }).imageFramingNodeId).toBeNull();
    // An id that is not an image on this page resolves to nothing.
    expect(factsOf(s, { editingImageId: 'gone' }).editingImage).toBeNull();
    // …and the Crop page over one unlocked image is the other way in.
    expect(factsOf(s, { cropOpen: true }).imageFramingNodeId).toBe(imageId);
  });

  test('nothing selected: every page shut, no facts to seed from', () => {
    const { session } = populated();
    const f = factsOf(session);
    expect(f.selected).toBeNull();
    expect(f.targetRefs).toEqual([]);
    expect(f.effectsHost).toBeNull();
    expect(f.objectOpacity).toBeUndefined();
    expect(f.effectPresent('shadow')).toBe(false);
  });

  test('a null session answers for nothing rather than throwing', () => {
    const f = factsOf(null);
    expect(f.multiIds).toBeNull();
    expect(f.selected).toBeNull();
    expect(f.svgPatternShape).toBeNull();
    expect(f.svgStrokePresent).toBeUndefined();
  });

  test('svgEnclosesRef and isRepeatTarget read the member, not the selection', () => {
    const { session, shapeId, lineId } = populated();
    expect(svgEnclosesRef(findItem(session.state, shapeId))).toBe(true);
    expect(svgEnclosesRef(findItem(session.state, lineId))).toBe(false);
    expect(svgEnclosesRef(null)).toBe(false);
    expect(isRepeatTarget(findItem(session.state, shapeId)!)).toBe(false);
    const repeating = {
      ...session.state,
      svgObjects: session.state.svgObjects.map((o) => (
        o.id === shapeId ? { ...o, tileMode: 'repeat' as const } : o
      )),
    };
    expect(isRepeatTarget(findItem(repeating, shapeId)!)).toBe(true);
  });
});

describe('buildPanelModel', () => {
  test('a page opens only for a selection that can open it', () => {
    const { session, imageId, shapeId } = populated();
    const image = select(session, imageId);
    expect(modelOf(image, { pages: { ...PAGES, cropOpen: true } }).cropOpen).toBe(true);
    expect(modelOf(image, { pages: { ...PAGES, endpointsOpen: true } }).endpointsOpen).toBe(false);
    const shape = select(session, shapeId);
    expect(modelOf(shape, { pages: { ...PAGES, endpointsOpen: true } }).endpointsOpen).toBe(true);
    expect(modelOf(shape, { pages: { ...PAGES, cropOpen: true } }).cropOpen).toBe(false);
  });

  test('Crop is a single-target page: a multi-selection never opens it', () => {
    const { session, imageId } = populated();
    const second = commitEntry(session, buildPlaceImage('img2', 'image/png', 50, 50,
      { cellX: 10, cellY: 10, cellWidth: 4, cellHeight: 4 }, new Uint8Array([2])));
    const ids = [imageId, second.state.images!.find((i) => i.id !== imageId)!.id];
    const multi = selectMany(second, ids);
    expect(modelOf(multi, { pages: { ...PAGES, cropOpen: true } }).cropOpen).toBe(false);
    expect(modelOf(multi).mode).toBe('multi');
  });

  test('Replace is offered for ONE unlocked image and nothing else', () => {
    const { session, imageId, shapeId } = populated();
    expect(modelOf(select(session, imageId)).onReplaceImage).toBeDefined();
    expect(modelOf(select(session, shapeId)).onReplaceImage).toBeUndefined();
    const locked = commitEntry(session, buildToggleLock(session.state, imageId)!);
    expect(modelOf(select(locked, imageId)).onReplaceImage).toBeUndefined();
  });

  test('a multi-selection with nothing to fade is not offered the Opacity writer', () => {
    const base = makeBlankComposition('cf');
    const state = {
      ...base,
      figures: [
        { id: 'fig1', cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 } as never,
        { id: 'fig2', cellX: 4, cellY: 0, cellWidth: 2, cellHeight: 2 } as never,
      ],
      sceneOrder: ['fig1', 'fig2'],
    };
    const s = selectMany(createEditorSession(state), ['fig1', 'fig2']);
    expect(modelOf(s).onObjectOpacity).toBeUndefined();
    // A single selection always gets it (the page is gated by opacityOpen).
    expect(modelOf(select(createEditorSession(state), 'fig1')).onObjectOpacity).toBeDefined();
  });

  test('the common actions reach the shell’s handlers, mirror by axis', () => {
    const { session, shapeId } = populated();
    const h = handlers();
    const m = modelOf(select(session, shapeId), { handlers: h });
    m.onRotate!();
    m.onMirrorH!();
    m.onMirrorV!();
    m.onDuplicate!();
    m.onToggleLock!();
    m.onDelete!();
    expect(h.calls).toEqual([
      'onRotate', 'onMirror:h', 'onMirror:v', 'onDuplicate', 'onToggleLock', 'onDelete',
    ]);
  });

  test('Ungroup is the FRAME’s own action, unset for anything else', () => {
    const { session, shapeId } = populated();
    expect(modelOf(select(session, shapeId)).onUngroup).toBeUndefined();
  });

  test('the host’s pages and its hidden common actions pass through — the one seam', () => {
    const { session, shapeId } = populated();
    const hostPages = { id: 'bot_a', pages: [{ key: 'processes', label: 'Processes', rows: [] }] };
    const m = modelOf(select(session, shapeId), {
      hostPages, hiddenCommonActions: ['duplicate'],
    });
    expect(m.hostPages).toBe(hostPages);
    expect(m.hiddenCommonActions).toEqual(['duplicate']);
    // An app with no host pages passes none, and the panel falls through to
    // the kind's own row.
    expect(modelOf(select(session, shapeId)).hostPages).toBeUndefined();
  });

  test('a host ITEM’s own lock lights the Lock button', () => {
    const { session } = populated();
    const host: SessionHost<{ locked: boolean }, unknown> = {
      items: {
        isHostId: (id) => id.startsWith('bot_'),
        itemById: (doc, id) => (id === 'bot_a' ? { id, locked: doc.locked } : null),
        items: () => [],
        box: () => null,
        through: (doc) => doc,
        remove: (doc) => doc,
        setGroup: (doc) => doc,
        setLocked: (doc) => doc,
        duplicate: (doc) => ({ doc, ids: [] }),
        change: () => null,
      },
    };
    installSessionHost(host);
    const open = { ...session, hostDoc: { locked: false }, selectedId: 'bot_a' } as unknown as EditorSession;
    const shut = { ...session, hostDoc: { locked: true }, selectedId: 'bot_a' } as unknown as EditorSession;
    expect(modelOf(open).locked).toBe(false);
    expect(modelOf(shut).locked).toBe(true);
  });

  test('a page the FORMAT withholds is named for the panel to drop', () => {
    const { session, shapeId } = populated();
    const m = modelOf(select(session, shapeId), { hiddenShapePages: ['stroke', 'fill'] });
    expect(m.svgHiddenActions).toEqual(['stroke', 'fill']);
  });

  test('the Pattern page’s Add and Edit need the format to allow a fill at all', () => {
    const { session, shapeId } = populated();
    const shape = select(session, shapeId);
    expect(modelOf(shape, { shapePatternFills: true }).onAddSvgPattern).toBeDefined();
    expect(modelOf(shape, { shapePatternFills: false }).onAddSvgPattern).toBeUndefined();
    // Nothing carries a fill yet, so neither Edit nor Remove is offered.
    expect(modelOf(shape, { shapePatternFills: true }).onEditSvgPattern).toBeUndefined();
    expect(modelOf(shape, { shapePatternFills: true }).onRemoveSvgPattern).toBeUndefined();
  });

  test('the Fade row is offered for every kind that has an ink, and not for paint', () => {
    const { session, shapeId } = populated();
    expect(modelOf(select(session, shapeId)).onPickFadeColor).toBeDefined();
    expect(modelOf(session).onPickFadeColor).toBeUndefined();
  });
});
