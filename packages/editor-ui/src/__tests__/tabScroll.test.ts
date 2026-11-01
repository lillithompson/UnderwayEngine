import fs from 'fs';
import path from 'path';
import { scrollToShowTab, TAB_REVEAL } from '../logic/tabScroll';

describe('scrollToShowTab: the selected tab is kept in view', () => {
  const view = 300;
  const content = 700;

  it('leaves a tab already in view where it is', () => {
    expect(scrollToShowTab({ x: 100, width: 60 }, view, 0, content)).toBeNull();
  });

  it('brings a tab cut at the right edge in, with the next one peeking past it', () => {
    expect(scrollToShowTab({ x: 280, width: 60 }, view, 0, content)).toBe(280 + 60 + TAB_REVEAL - view);
  });

  it('brings a tab cut at the left edge in the same way', () => {
    expect(scrollToShowTab({ x: 200, width: 60 }, view, 250, content)).toBe(200 - TAB_REVEAL);
  });

  it('never scrolls past either end of the content', () => {
    expect(scrollToShowTab({ x: 650, width: 50 }, view, 0, content)).toBe(content - view);
    expect(scrollToShowTab({ x: 10, width: 50 }, view, 200, content)).toBe(0);
  });

  it('does nothing for a row that fits, or one not yet measured', () => {
    expect(scrollToShowTab({ x: 280, width: 60 }, view, 0, view)).toBeNull();
    expect(scrollToShowTab({ x: 280, width: 60 }, 0, 0, content)).toBeNull();
  });

  it('centres a tab too wide to show with room either side', () => {
    expect(scrollToShowTab({ x: 400, width: 250 }, view, 0, content)).toBe(400 - 25);
  });

  it('is what the Edit sheet’s tab row scrolls by, through the one hook every tab row shares', () => {
    const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', 'components', f), 'utf8');
    const hook = src('useSelectedTabInView.ts');
    expect(hook).toContain("import { scrollToShowTab } from '../logic/tabScroll';");
    expect(hook).toContain('const to = scrollToShowTab(box, viewW, scrollX.current, contentW);');
    const sheet = src('EditSheet.tsx');
    expect(sheet).toContain('const inView = useSelectedTabInView(selected);');
    expect(sheet).toContain('ref={inView.scrollView}');
    expect(sheet).toContain('onBox={(box) => inView.onTabBox(t.key, box)}');
    expect(sheet).not.toContain('scrollToShowTab');
  });
});
