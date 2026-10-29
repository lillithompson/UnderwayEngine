import { PAGE_IO } from '../store/pageIO';

// The one constant every page round trip passes the engine. Each flag is a
// decision this editor made about the engine's defaults, pinned so a copy
// of the literal in an app (there have been several) is caught drifting.
test('PAGE_IO: no normalization on any side, and figures baked to svgs on import', () => {
  // Page-anchored coordinates are positions on the fixed page.
  expect(PAGE_IO.normalize).toBe(false);
  // This canvas has no figure render path (CanvasSurface renderNode: "figures
  // render via the GL pass only", and that pass draws the grid alone), so
  // an import keeps no figures.
  expect(PAGE_IO.bakeFigures).toBe(true);
});
