'use strict';

/**
 * A flow's frames made small enough to embed: each PNG drawn at a width of
 * its own on a canvas in headless Chrome and read back as a JPEG data URL.
 * Chrome is what a capture already needs, so this runs wherever a capture
 * does (it was macOS's `sips` until 2026-11-19, which Windows has not).
 * Used by the writeup (build-writeup.js) and the side-by-side PDF
 * (compare-pdf.js).
 */

const fs = require('node:fs');
const { CHROME } = require('./harness.js');

/** IN THE PAGE: the PNG data URL `png` drawn `width` wide at its own
 *  shape, as a JPEG data URL of `quality` (0..1). Self-contained, as
 *  `evaluate` needs. */
async function drawAsJpeg({ png, width, quality }) {
  const img = new Image();
  img.src = png;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = width;
  c.height = Math.round((img.naturalHeight * width) / img.naturalWidth);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

/** The PNGs at `files` as JPEG data URLs, the k-th `widths[k]` wide, in
 *  one Chrome opened for them all. */
async function toJpegs(files, widths, quality = 0.72) {
  // eslint-disable-next-line global-require
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const page = await browser.newPage();
    const out = [];
    for (const [k, file] of files.entries()) {
      const png = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
      out.push(await page.evaluate(drawAsJpeg, { png, width: widths[k], quality }));
    }
    return out;
  } finally {
    await browser.close();
  }
}

module.exports = { toJpegs };
