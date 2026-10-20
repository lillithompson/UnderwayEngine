/**
 * The host-tool registry (hostTools.ts): how an app's own tools reach the
 * shared toolbar. A made-up app here — a tool that holds a capsule, two
 * that ride the content row behind format flags, and a setting — so the
 * seam is tested without naming any app's tool; each app pins its own
 * registry in its own tree.
 */

import { HostTool, NO_HOST_TOOLS, hostTool, hostToolMeta } from '../hostTools';
import {
  DEFAULT_CONTENT_MODE,
  TOOL_META,
  buttonArmingTool,
  contentModeIcon,
  contentModeLabel,
  contentModeOfToolId,
  contentModeRow,
  contentModeTarget,
  contentModes,
  deadContentModes,
  holdRecallsModeCapsule,
  isContentToolId,
  toolMetaFor,
  toolbarButtonLit,
} from '../components/toolbarMeta';

/** The MaterialCommunityIcons glyph map, where the font is installed. The
 *  font is the consuming app's (a peer dependency), so the pin that reads
 *  it runs in every app's suite — which roots jest at this package too —
 *  and is skipped in the standalone engine clone, where there is no font. */
function mciGlyphs(): Record<string, number> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json');
  } catch {
    return null;
  }
}
const MCI_GLYPHS = mciGlyphs();

type FernToolId = 'seed' | 'leaf' | 'bloom' | 'mirror';

const FERN: readonly HostTool<FernToolId>[] = [
  // A tool with a capsule of its own (Sol's Plant is this shape).
  { id: 'seed', label: 'Seed', icon: 'sprout', modeCapsule: true },
  // Two placing tools on the content row, each behind a format flag
  // (CozyJournal's Figure and Word are this shape).
  { id: 'leaf', label: 'Leaf', icon: 'leaf', contentMode: { gate: 'leafTool' } },
  { id: 'bloom', label: 'Bloom', icon: 'flower', contentMode: { gate: 'bloomTool' } },
  // A setting: its press toggles something and arms nothing.
  { id: 'mirror', label: 'Mirror', icon: 'flip-horizontal', kind: 'setting' },
];

describe('the registry', () => {
  it('finds a registered tool by id, and nothing for a standard one or nothing armed', () => {
    expect(hostTool(FERN, 'seed')?.label).toBe('Seed');
    expect(hostTool(FERN, 'arrange')).toBeUndefined();
    expect(hostTool(FERN, 'content')).toBeUndefined();
    expect(hostTool(FERN, null)).toBeUndefined();
    expect(hostTool(FERN, undefined)).toBeUndefined();
    expect(hostTool(NO_HOST_TOOLS, 'seed')).toBeUndefined();
  });

  it('reads as a TOOL_META-shaped table over the host’s own ids', () => {
    expect(hostToolMeta(FERN)).toEqual({
      seed: { label: 'Seed', icon: 'sprout' },
      leaf: { label: 'Leaf', icon: 'leaf' },
      bloom: { label: 'Bloom', icon: 'flower' },
      mirror: { label: 'Mirror', icon: 'flip-horizontal' },
    });
  });

  it('lays over the standard table without touching a standard row', () => {
    const table = toolMetaFor(FERN);
    expect(table.seed).toEqual({ label: 'Seed', icon: 'sprout' });
    expect(table.arrange).toBe(TOOL_META.arrange);
    expect(Object.keys(table)).toEqual([...Object.keys(TOOL_META), 'seed', 'leaf', 'bloom', 'mirror']);
    // An empty registry is the standard table and nothing more.
    expect(toolMetaFor(NO_HOST_TOOLS)).toEqual(TOOL_META);
  });

  (MCI_GLYPHS ? it : it.skip)('every registered glyph is one the shipped font has — the standard rows’ own rule', () => {
    const glyphs = MCI_GLYPHS!;
    for (const t of FERN) expect([t.id, glyphs[t.icon] !== undefined]).toEqual([t.id, true]);
  });
});

describe('a host tool on the content row', () => {
  it('rides after Image and Text, in the registry’s order, under its own id, word and glyph', () => {
    expect(contentModeRow(FERN)).toEqual(['image', 'text', 'leaf', 'bloom']);
    expect(contentModeRow(NO_HOST_TOOLS)).toEqual(['image', 'text']);
    expect(contentModeLabel('leaf', FERN)).toBe('Leaf');
    expect(contentModeIcon('bloom', FERN)).toBe('flower');
    // The standard rows read the same way, registry or not.
    expect(contentModeLabel('image', FERN)).toBe('Image');
    expect(contentModeIcon('text', NO_HOST_TOOLS)).toBe(TOOL_META.text.icon);
    // A mode this bar does not carry is a programming error, not a blank.
    expect(() => contentModeLabel('leaf', NO_HOST_TOOLS)).toThrow('not a content mode of this bar: leaf');
  });

  it('is offered only where its gate flag is set, and narrows by name like the rest', () => {
    expect(contentModes({}, FERN)).toEqual(['image', 'text']);
    expect(contentModes({ leafTool: true } as object, FERN)).toEqual(['image', 'text', 'leaf']);
    expect(contentModes({ bloomTool: true } as object, FERN)).toEqual(['image', 'text', 'bloom']);
    expect(contentModes({ leafTool: true, bloomTool: true } as object, FERN)).toEqual(contentModeRow(FERN));
    // Named without its flag, a host mode grants nothing: the flag is what
    // says the thing behind it exists.
    expect(contentModes({ contentTools: ['text', 'leaf'] }, FERN)).toEqual(['text']);
    // Order stays the row's, not the format's.
    expect(contentModes({ leafTool: true, bloomTool: true, contentTools: ['bloom', 'leaf', 'text'] } as object, FERN))
      .toEqual(['text', 'leaf', 'bloom']);
    // A tool with no contentMode never appears, whatever flags are set.
    expect(contentModes({ seedTool: true, mirrorTool: true } as object, FERN)).toEqual(['image', 'text']);
    expect(contentModes({}, FERN)).toContain(DEFAULT_CONTENT_MODE);
  });

  it('a gate set and then filtered out by name is a dead mode', () => {
    expect(deadContentModes({ leafTool: true, contentTools: ['text', 'bloom'] } as object, FERN)).toEqual(['leaf']);
    expect(deadContentModes({ leafTool: true, bloomTool: true, contentTools: ['text'] } as object, FERN))
      .toEqual(['leaf', 'bloom']);
    expect(deadContentModes({ leafTool: true, contentTools: ['leaf'] } as object, FERN)).toEqual([]);
    // Leaving out Image or Text is the point of contentTools, never dead.
    expect(deadContentModes({ contentTools: ['text'] }, FERN)).toEqual([]);
    expect(deadContentModes({ leafTool: true } as object, FERN)).toEqual([]);
  });

  it('targets its own tool, and is read back from it', () => {
    expect(contentModeTarget('leaf')).toBe('leaf');
    expect(contentModeTarget('image')).toBe('photos');
    expect(contentModeOfToolId('leaf', FERN)).toBe('leaf');
    expect(contentModeOfToolId('photos', FERN)).toBe('image');
    // Not on this bar's row: a tool with no content mode, or no registry.
    expect(contentModeOfToolId('seed', FERN)).toBeNull();
    expect(contentModeOfToolId('leaf', NO_HOST_TOOLS)).toBeNull();
    expect(contentModeOfToolId(null, FERN)).toBeNull();
  });

  it('lights the content button and holds its pushdown open, like Image and Text', () => {
    expect(isContentToolId('leaf', FERN)).toBe(true);
    expect(isContentToolId('bloom', FERN)).toBe(true);
    expect(isContentToolId('seed', FERN)).toBe(false);
    expect(isContentToolId('leaf', NO_HOST_TOOLS)).toBe(false);
    expect(toolbarButtonLit('content', 'leaf', FERN)).toBe(true);
    expect(toolbarButtonLit('content', 'leaf', NO_HOST_TOOLS)).toBe(false);
  });

  it('names the bar button that arms it, or none', () => {
    // Its own button on a bespoke bar; the content group where the format
    // opens its gate; nothing on a bar with no way to it.
    expect(buttonArmingTool({ tools: ['arrange', 'leaf', 'mirror'] }, 'leaf', FERN)).toBe('leaf');
    expect(buttonArmingTool({ tools: ['arrange', 'content'], leafTool: true } as { tools: string[] }, 'leaf', FERN))
      .toBe('content');
    expect(buttonArmingTool({ tools: ['arrange', 'content'] }, 'leaf', FERN)).toBeNull();
    expect(buttonArmingTool({ tools: ['arrange', 'photos'], leafTool: true } as { tools: string[] }, 'leaf', FERN))
      .toBeNull();
    // …nor a group narrowed past it by name.
    expect(buttonArmingTool(
      { tools: ['arrange', 'content'], leafTool: true, contentTools: ['text'] } as { tools: string[] }, 'leaf', FERN,
    )).toBeNull();
    expect(buttonArmingTool(
      { tools: ['arrange', 'content'], leafTool: true, contentTools: ['text', 'leaf'] } as { tools: string[] }, 'leaf', FERN,
    )).toBe('content');
    // The same question of a standard tool.
    expect(buttonArmingTool({ tools: ['arrange', 'content'] }, 'photos', FERN)).toBe('content');
    expect(buttonArmingTool({ tools: ['arrange', 'text'] }, 'text', NO_HOST_TOOLS)).toBe('text');
  });
});

describe('what arming a host tool does', () => {
  it('a tool lights its button while in hand; a setting never lights', () => {
    expect(toolbarButtonLit('seed', 'seed', FERN)).toBe(true);
    expect(toolbarButtonLit('seed', 'arrange', FERN)).toBe(false);
    expect(toolbarButtonLit('mirror', 'mirror', FERN)).toBe(false);
    expect(toolbarButtonLit('mirror', null, FERN)).toBe(false);
    // Unregistered, a button lights for its own id like any plain tool —
    // the registry is what says a button is a setting.
    expect(toolbarButtonLit('mirror', 'mirror', NO_HOST_TOOLS)).toBe(true);
  });

  it('a hold on the lit button recalls its capsule only where the record says it holds one', () => {
    expect(holdRecallsModeCapsule('seed', 'seed', FERN)).toBe(true);
    expect(holdRecallsModeCapsule('seed', null, FERN)).toBe(false);
    expect(holdRecallsModeCapsule('seed', 'seed', NO_HOST_TOOLS)).toBe(false);
    // A content-row host tool arms under the content button, whose
    // capsule it is; its own id is no button.
    expect(holdRecallsModeCapsule('content', 'leaf', FERN)).toBe(true);
    expect(holdRecallsModeCapsule('leaf', 'leaf', FERN)).toBe(false);
    // A setting holds no capsule and is never lit.
    expect(holdRecallsModeCapsule('mirror', 'mirror', FERN)).toBe(false);
    // The standard groups are unchanged by a registry.
    expect(holdRecallsModeCapsule('paints', 'blur', FERN)).toBe(true);
    expect(holdRecallsModeCapsule('color', 'color', FERN)).toBe(false);
  });
});
