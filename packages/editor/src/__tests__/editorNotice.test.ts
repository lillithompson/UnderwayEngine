import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  NOTICE_FONT_SIZE, NOTICE_MAX_WIDTH, NOTICE_MS, NOTICE_RADIUS, useEditorNotice,
} from '../editorNotice';
import { NOTICE_Z } from '../overlayZ';

// The editor's one-line notice — its timing, its shape, and the card.
// Byte-identical in all three apps but for Sol's `quiet`, adopted here as
// the superset (stage 6.5a of docs/shared-editor.md).

const SRC = (...parts: string[]) => readFileSync(resolve(__dirname, '..', ...parts), 'utf8');
const HOOK = SRC('editorNotice.ts');
const CARD = SRC('components', 'EditorNotice.tsx');

describe('the notice’s measurements', () => {
  it('stands long enough to read a sentence, and not so long it outlives the gesture', () => {
    expect(NOTICE_MS).toBe(2600);
  });

  it('is sized as a sentence, a clear step up from a capsule label’s 11px', () => {
    expect(NOTICE_FONT_SIZE).toBe(17);
    expect(NOTICE_FONT_SIZE).toBeGreaterThan(11);
  });

  it('breaks the longest refusal over two lines rather than running as one bar', () => {
    expect(NOTICE_MAX_WIDTH).toBe(260);
  });

  it('reads as a card’s corners, not a pill’s — well under half its height', () => {
    expect(NOTICE_RADIUS).toBe(18);
    expect(NOTICE_RADIUS * 2).toBeLessThan(NOTICE_FONT_SIZE * 2 + 40);
  });
});

describe('useEditorNotice — the state and the one way to raise it', () => {
  it('is a hook; the card beside it is read as text, being a .tsx', () => {
    expect(typeof useEditorNotice).toBe('function');
    expect(CARD).toContain('export function EditorNotice(');
  });

  it('every show is a KEYED remount, so a second notice restarts the keyframe', () => {
    // Two refusals in a row say the same words; without the bump the card
    // would stand still and read as the first one never having cleared.
    expect(HOOK).toContain('key: (prev?.key ?? 0) + 1');
  });

  it('a show resets the standing timer rather than stacking a second one', () => {
    expect(HOOK).toContain('if (timer.current) clearTimeout(timer.current);');
    expect(HOOK).toContain(`timer.current = setTimeout(() => { timer.current = null; setNotice(null); }, NOTICE_MS);`);
  });

  it('unmount clears the timer: no setState into a gone shell', () => {
    expect(HOOK).toContain('useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);');
  });

  it('knocks the finger — except on a line that REPORTS rather than refuses', () => {
    // Sol's undo notice asks for `quiet`; it is optional, so the two apps
    // that had no such line pay nothing for it.
    expect(HOOK).toContain(`if (!opts?.quiet) triggerHaptic('heavy');`);
    expect(HOOK).toContain(`opts?: { quiet?: boolean }`);
  });

  it('the knock is the heavy one, not a tap the editor spends on things that worked', () => {
    expect(HOOK).toContain(`triggerHaptic('heavy')`);
    expect(HOOK.match(/triggerHaptic\(/g)).toHaveLength(1);
  });
});

describe('the card', () => {
  it('takes its z from the one place that orders the layers', () => {
    expect(CARD).toContain('zIndex: NOTICE_Z,');
    expect(CARD).toContain(`from '../overlayZ'`);
    expect(NOTICE_Z).toBeGreaterThan(0);
  });

  it('takes no pointer events, so sitting on top costs the overlay under it nothing', () => {
    expect(CARD).toContain('pointerEvents');
  });

  it('wears the floating capsules’ chrome rather than a colour of its own', () => {
    expect(CARD).toContain(`from './floatingCapsuleStyle'`);
    expect(CARD).toContain('FLOATING_CAPSULE_BG');
    expect(CARD).toContain('FLOATING_CAPSULE_INK');
  });
});
