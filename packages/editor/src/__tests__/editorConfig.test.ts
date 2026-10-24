import { readFileSync } from 'fs';
import { join } from 'path';

import { PATTERN_SYMMETRY_OFF } from '@/engine/types';

import {
  type CommonEditorConfig,
  DEFAULT_FRAME_BACKGROUND,
  type ShapeLock,
  type ShapePropertyPage,
} from '../formats/editorConfig';

// The common half of a format's EditorConfig (stage 6.3b of
// docs/shared-editor.md): 21 of the 22 members every app declares were
// byte-identical in comment and declaration, and `canvas` nested exactly.
//
// THIS SUITE IS ALSO WHAT TYPECHECKS THE FILE. The engine's `npm run
// typecheck` excludes packages/editor and packages/editor-ui from the root
// tsconfig, so what checks a file here is ts-jest's diagnostics while a
// suite loads it — which means a package module no suite reaches is
// typechecked by NOTHING in this repo. Verified both ways: a deliberate
// `const n: number = 'x'` in store/storeKeys.ts leaves `npm run typecheck`
// green and fails `npm test` with TS2322.

describe('the four ids an app narrows', () => {
  // formatId, tools, firstTool and contentTools are `string` here because
  // every app's union is its own (§4.3's ToolId decision, taken at stage 2).
  // What has to hold is that an app can narrow them back to a CLOSED union
  // and still satisfy this interface — otherwise each app would have to
  // restate the whole config rather than extend it.
  type AppToolId = 'select' | 'draw' | 'plant';
  type AppContentMode = 'image' | 'tile';
  type AppFormatId = 'daily' | 'freePlay';

  interface AppEditorConfig extends CommonEditorConfig {
    formatId: AppFormatId;
    tools: AppToolId[];
    firstTool?: AppToolId;
    contentTools?: AppContentMode[];
    /** An app's own field, the way each app's really does. */
    ownThing?: { depth: number };
  }

  const config: AppEditorConfig = {
    formatId: 'daily',
    tools: ['select', 'draw', 'plant'],
    firstTool: 'draw',
    contentTools: ['image', 'tile'],
    canvas: { aspect: 1 },
    ownThing: { depth: 2 },
  };

  test('an app config with closed unions IS a CommonEditorConfig', () => {
    // The assignment is the assertion: it would not compile otherwise.
    const common: CommonEditorConfig = config;
    expect(common.formatId).toBe('daily');
    expect(common.tools).toEqual(['select', 'draw', 'plant']);
    expect(common.firstTool).toBe('draw');
    expect(common.contentTools).toEqual(['image', 'tile']);
  });

  test('the package reads a tool id as a string without knowing the union', () => {
    // What a package function does with config.tools: no narrowing, no
    // exhaustive switch, just the ids.
    const armed = (c: CommonEditorConfig): string | undefined =>
      c.firstTool ?? c.tools[0];
    expect(armed(config)).toBe('draw');
    expect(armed({ formatId: 'x', tools: ['only'], canvas: { aspect: 1 } }))
      .toBe('only');
  });
});

describe('the canvas superset', () => {
  // DrawBots' canvas was the strict superset: Sol's lacked initialFitName
  // and symmetryDefault, CozyJournal's lacked hideGridControls, and all
  // three extras are OPTIONAL — which is what made adopting the superset
  // free for the two apps that had neither.
  test('the three adopted members are optional', () => {
    const bare: CommonEditorConfig = {
      formatId: 'f', tools: [], canvas: { aspect: 1 },
    };
    expect(bare.canvas.initialFitName).toBeUndefined();
    expect(bare.canvas.symmetryDefault).toBeUndefined();
    expect(bare.canvas.hideGridControls).toBeUndefined();
  });

  test('each is accepted when a format does declare it', () => {
    const full: CommonEditorConfig = {
      formatId: 'f',
      tools: [],
      canvas: {
        aspect: 0.75,
        initialFitName: 'Mask',
        symmetryDefault: { ...PATTERN_SYMMETRY_OFF, mirrorH: true },
        hideGridControls: true,
      },
    };
    expect(full.canvas.initialFitName).toBe('Mask');
    expect(full.canvas.symmetryDefault?.mirrorH).toBe(true);
    expect(full.canvas.hideGridControls).toBe(true);
  });
});

describe('the leaves that exist for the config', () => {
  test('a shape lock pins a mode, a side count, or both', () => {
    const lock: ShapeLock = { line: 'rectangle', polygonSides: 3 };
    expect(lock.line).toBe('rectangle');
    expect(lock.arc).toBeUndefined();
    expect(lock.polygonSides).toBe(3);
  });

  test('the withholdable panel pages are the four the panel offers', () => {
    const all: ShapePropertyPage[] = ['stroke', 'fill', 'effects', 'opacity'];
    expect(all).toHaveLength(4);
  });

  test('the frame background default is the warm off-white, #F4F3F1', () => {
    expect(DEFAULT_FRAME_BACKGROUND).toEqual({ r: 244, g: 243, b: 241 });
  });
});

describe('no app’s own vocabulary reached the package', () => {
  const src = readFileSync(
    join(__dirname, '..', 'formats', 'editorConfig.ts'), 'utf8',
  );
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

  // The header NAMES these three, to say why they are not here; the code
  // must not. Spelt as a list rather than three tests so a fourth app type
  // creeping in is a one-line addition.
  test.each(['FormatId', 'ToolId', 'ContentMode'])(
    'the code never names %s', (name) => {
      expect(code).not.toMatch(new RegExp(`\\b${name}\\b`));
    },
  );

  test('and the header does name them, which is where the reason lives', () => {
    expect(src).toContain('WHY THE TOOL AND FORMAT IDS ARE `string` HERE');
    for (const n of ['FormatId', 'ToolId', 'ContentMode']) {
      expect(src).toContain(n);
    }
  });
});
