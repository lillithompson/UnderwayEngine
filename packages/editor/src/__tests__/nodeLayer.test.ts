/**
 * The node layer's SEAMS — the parts of `components/NodeLayer.tsx` that
 * exist for a host rather than for anything the shared editor draws.
 *
 * Screens can't render in the node test env (there is no renderer in this
 * package: no engine suite imports a component), so this pins the source
 * the way `textPaintPreview.test.ts` and the apps' parity tests do.
 *
 * Why this file exists at all: a seam no shared caller exercises reads, to
 * anyone working in THIS repo, as dead code. `SvgNodeLayer`'s `children`
 * is the one generic addition stage 5a adopted from a non-canonical copy
 * (Sol's, docs/shared-editor.md §4.2 item 5), and the only thing that
 * passes it lives in another repository — so deleting it leaves every
 * suite here green, every app's typecheck clean, and Sol's seed markers
 * silently missing their strain initial. The pin is here and not in Sol
 * because an app-side pin cannot fail the run of the repo doing the
 * deleting.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const NODE_LAYER = readFileSync(
  resolve(__dirname, '..', 'components', 'NodeLayer.tsx'), 'utf8',
);

/** `SvgNodeLayer`'s body, to the first declaration after it. */
const svgNodeLayer = (() => {
  const from = NODE_LAYER.indexOf('export const SvgNodeLayer');
  expect(from).toBeGreaterThanOrEqual(0);
  const to = NODE_LAYER.indexOf('function outlineCastObject', from);
  expect(to).toBeGreaterThan(from);
  return NODE_LAYER.slice(from, to);
})();

describe('SvgNodeLayer takes a host’s own marking as children', () => {
  it('declares the prop', () => {
    expect(svgNodeLayer).toContain('children?: React.ReactNode;');
    expect(svgNodeLayer).toContain('{ drawn, strokeScale, children }');
  });

  it('…and RENDERS it inside the matrix wrapper, after the paint host', () => {
    // The assertion the deletion fails. Inside `innerStyle(frame)` is what
    // makes the marking ride the node's pose and the gestures with it; a
    // marking drawn in the OUTER box would stand still under a drag.
    const inner = svgNodeLayer.slice(svgNodeLayer.indexOf('<div style={innerStyle(frame)}>'));
    expect(inner).toContain('{children}');
    expect(inner.indexOf('{host}')).toBeLessThan(inner.indexOf('{children}'));
  });

});

// No case here pins what the CALLERS pass: this package renders the layer
// nowhere yet — every `<SvgNodeLayer` in the three trees is an app's canvas,
// and each app pins its own (Sol's seed marker is `plantLayerWiring.test`).
// The canvas arrives at stage 5b, and the caller-side case arrives with it.
