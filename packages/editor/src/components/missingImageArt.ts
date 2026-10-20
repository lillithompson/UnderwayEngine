// Placeholder art for an image node whose bytes aren't set yet. An empty image
// frame used to render nothing (ImageNodeLayer returned null on `!src`), so the
// slot was invisible; instead we draw the "no image" mountain — the shape from
// assets/images/Mountain_01.svg — recolored to a light grey so the frame reads
// as a slot waiting to be filled rather than a void.
//
// The paths are inlined (not imported from assets/) on purpose: the WebView
// editor build has no SVG asset loader, and inlining lets the grey recolor be
// baked in at an exact tone (matching the grey Mountain.svg sibling) rather than
// fought for with a CSS filter over a black source. It's a vector data URI, so
// it stays crisp at every canvas zoom.

/** Light grey the mountain is recolored to (matches assets/images/Mountain.svg). */
export const MISSING_IMAGE_GREY = '#D9D9D9';

// Paths copied verbatim from assets/images/Mountain_01.svg (viewBox 821×718),
// with the source `fill="black"` swapped for the grey above.
const MOUNTAIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="821" height="718" ' +
  'viewBox="0 0 821 718" fill="none">' +
  '<path d="M463.516 225.438C467.495 220.951 474.5 220.951 478.479 225.438L707.245 ' +
  '483.367C712.966 489.819 708.387 500.002 699.763 500.002L121.019 500.003C112.396 ' +
  '500.003 107.816 489.818 113.539 483.367L264.297 313.435C268.276 308.95 275.28 ' +
  '308.95 279.258 313.435L324.89 364.869C328.869 369.354 335.874 369.354 339.852 ' +
  `364.868L463.516 225.438Z" fill="${MISSING_IMAGE_GREY}"/>` +
  '<path d="M339.78 163C366.289 163 387.78 184.49 387.78 211C387.78 237.51 366.289 ' +
  '259 339.78 259C313.27 259 291.78 237.51 291.78 211C291.78 184.49 313.27 163 ' +
  `339.78 163Z" fill="${MISSING_IMAGE_GREY}"/>` +
  '</svg>';

/** The grey mountain as an `<img>`-ready data URI. Rendered with
 *  `object-fit: contain` so it scales to fit any frame aspect ratio, centered. */
export const MISSING_IMAGE_DATA_URI =
  `data:image/svg+xml,${encodeURIComponent(MOUNTAIN_SVG)}`;
