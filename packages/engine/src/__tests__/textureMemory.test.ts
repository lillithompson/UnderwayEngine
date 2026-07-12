/**
 * Regression guard for the figure editor's GPU memory budget.
 *
 * `FREE_TEXTURE_POOL_MAX` was lowered from 3 to 1 to reduce concurrent
 * GPU pressure on iOS WKWebView, which was causing the figure editor's
 * WebGL context to silently die under load (canvas goes blank until app
 * restart). Each pooled texture is a 2048×2048 RGBA IOSurface (~16 MB),
 * so raising this back to 3 reintroduces ~32 MB of resident GPU per
 * editor open.
 */

import * as fs from 'fs';
import * as path from 'path';

describe('Renderer free-texture pool budget', () => {
  it('FREE_TEXTURE_POOL_MAX stays at 1', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'gl', 'renderer.ts'),
      'utf8',
    );
    const match = src.match(/FREE_TEXTURE_POOL_MAX\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(1);
  });
});
