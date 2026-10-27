// The host-page seam's two words to the panel that no row carries
// (stage 7a of docs/shared-editor.md): an element that is its OWN BOX,
// and the host hearing which of its pages is up.
//
// The panel is RN with no test renderer here, so both are pinned at the
// source, as every screen fact in this package is.
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), 'utf8');

const BAR = read('components', 'HostPageBar.tsx');
const PANEL = read('components', 'ObjectPropertiesPanel.tsx');
const ADAPTER = read('adapter.ts');

describe('a host element that is its own box (HostPage.element.bare)', () => {
  it('is declared beside the element, once', () => {
    expect(ADAPTER).toContain('element?: { node: React.ReactNode; height: number; scrolls?: boolean; bare?: boolean };');
  });

  it('stands alone in the well’s place — no body of rows round it', () => {
    // The Copies page's arrangement: a RowGroup inside a BarBody inside
    // the well framed the box twice. Any other element keeps its body.
    expect(BAR).toContain('if (page.element) return page.element.bare ? <>{page.element.node}</> : <BarBody>{page.element.node}</BarBody>;');
  });

  it('is drawn with no well, and measured with none, off the one flag', () => {
    // The sheet's well and the height arithmetic read the same field, so a
    // page cannot be measured one way and drawn the other (the rule
    // pageIsWelled already keeps for the panel's own pages).
    expect(PANEL).toContain('welled={!displaySub || (shownHostPage ? !shownHostPage.element?.bare : pageIsWelled(displaySub))}');
    expect(PANEL).toContain('bare: shownHostPage.element?.bare,');
  });
});

describe('the host hears which of its pages is up (HostPagesModel.onPageChange)', () => {
  it('is an optional word on the model, keyed by the page', () => {
    expect(ADAPTER).toContain('onPageChange?(page: string | null): void;');
  });

  it('is read off the OPEN page, which goes null the instant the sheet closes', () => {
    // Not `displaySub`: that keeps the last page through the slide down,
    // and a host dropping a base when its page goes would hear nothing.
    expect(PANEL).toContain('const openHostPage = activeSub ? hostPageOfSubmenu(activeSub) : null;');
    // …through a ref, so a model rebuilt every render never re-fires it.
    expect(PANEL).toMatch(/useEffect\(\(\) => \{\s*hostPagesRef\.current\?\.onPageChange\?\.\(openHostPage\);\s*\}, \[openHostPage\]\);/);
  });
});
