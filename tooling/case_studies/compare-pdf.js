#!/usr/bin/env node
'use strict';

// A flow filmed on several screens at once, laid side by side and printed
// to a PDF: a page for each screen state, a column for each device. Its
// frames are named NN-<device>-<state>, each <device> a key of
// writeup.json's `people` (whose badges the writeup gives them, in that
// order), and a state filmed on each device under the same <state>; where a
// device has no frame of a state, its cell says so. The writeup's title and
// lede open it, each page is headed by its phase and each frame captioned
// by its step, and the findings close it. Run it from inside the project,
// after the flow's writeup.json is written (build-writeup.js checks it):
//
//   node vendor/UnderwayEngine/tooling/case_studies/compare-pdf.js <flow> [out.pdf]
//
// out.pdf defaults to <caseStudies>/flows/<flow>/<flow>.pdf, beside the
// frames. It prints whether any page's words run past its foot.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { CHROME } = require('./harness.js');
const { toJpegs } = require('./jpegs.js');
const { embedWidth, pngSize, validate } = require('./build-writeup.js');
const { caseStudyPaths } = require('./paths.js');

/** A page, in CSS px: 13⅓ × 7½ inches, a landscape slide's. */
const PAGE = { width: 1280, height: 720, pad: 36 };
/** The gap between two cells, the narrowest a cell is (its caption must
 *  still read), and the tallest a frame is drawn. */
const GAP = 24;
const MIN_CELL = 220;
const MAX_FRAME_HEIGHT = 420;

/** The flow's frames (names in order) as rows: one per state, holding each
 *  device's frame index, or null where that device has none. A row comes
 *  after every state its devices filmed before it — a state only one
 *  device has (the iPad's preview of a template) stays before the next
 *  state on that device, whenever the others filmed theirs — and rows
 *  free to go in either order go in the order first filmed. Throws on a
 *  name that is not NN-<device>-<state> with a listed device, on a state
 *  filmed twice on one device, and on devices that film two states in
 *  opposite orders. */
function compareRows(pngs, keys) {
  const rows = [];
  const byState = new Map();
  pngs.forEach((name, i) => {
    const m = /^\d+-([^-]+)-(.+)\.png$/.exec(name);
    if (!m || !keys.includes(m[1])) throw new Error(`${name} is not NN-<device>-<state> with a device of ${keys.join(', ')}`);
    const [, key, state] = m;
    let row = byState.get(state);
    if (!row) {
      row = { state, first: i, cells: Object.fromEntries(keys.map((k) => [k, null])) };
      byState.set(state, row);
      rows.push(row);
    }
    if (row.cells[key] != null) throw new Error(`"${state}" is filmed twice on ${key}`);
    row.cells[key] = i;
  });
  // Each row's states that come before it on some device.
  const before = new Map(rows.map((r) => [r, []]));
  for (const k of keys) {
    const seq = rows.filter((r) => r.cells[k] != null).sort((a, b) => a.cells[k] - b.cells[k]);
    seq.forEach((r, j) => { if (j > 0) before.get(r).push(seq[j - 1]); });
  }
  const ordered = [];
  const left = [...rows];
  while (left.length) {
    const j = left.findIndex((r) => before.get(r).every((p) => ordered.includes(p)));
    if (j < 0) throw new Error(`the devices film ${left.map((r) => `"${r.state}"`).join(', ')} in orders that contradict each other`);
    ordered.push(left.splice(j, 1)[0]);
  }
  return ordered;
}

/** The height a row's frames are drawn at and each cell's width, for cells
 *  of `aspects` (width / height) across `width`: the tallest that fits,
 *  up to MAX_FRAME_HEIGHT, no cell narrower than MIN_CELL. */
function rowLayout(aspects, width = PAGE.width - 2 * PAGE.pad) {
  const room = width - GAP * (aspects.length - 1);
  const widths = (h) => aspects.map((a) => Math.max(MIN_CELL, Math.floor(h * a)));
  let h = MAX_FRAME_HEIGHT;
  while (h > 60 && widths(h).reduce((s, w) => s + w, 0) > room) h -= 1;
  return { height: h, widths: widths(h) };
}

/** The phase that frame index `i` is in. */
function phaseOf(i, phases) {
  const k = phases.findIndex(([, from, to]) => i + 1 >= from && i + 1 <= to);
  return { name: phases[k][0], index: k };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** The PDF's page, as HTML: `frames` are { src, w, h } per PNG, in order. */
function comparePage(spec, rows, frames) {
  const keys = Object.keys(spec.people);
  // A device's shape where it has no frame of a state: its first frame's.
  const shapeOf = Object.fromEntries(keys.map((k) => {
    const row = rows.find((r) => r.cells[k] != null);
    const f = row ? frames[row.cells[k]] : { w: 9, h: 16 };
    return [k, f.w / f.h];
  }));
  const badge = (k) => `<span class="who p${keys.indexOf(k)}">${esc(spec.people[k])}</span>`;
  const sheets = rows.map((row, n) => {
    const aspects = keys.map((k) => (row.cells[k] == null ? shapeOf[k] : frames[row.cells[k]].w / frames[row.cells[k]].h));
    const { height, widths } = rowLayout(aspects);
    const phase = phaseOf(row.first, spec.phases);
    const cells = keys.map((k, c) => {
      const i = row.cells[k];
      const box = `width:${widths[c]}px`;
      const shot = `width:${Math.floor(height * aspects[c])}px;height:${height}px`;
      if (i == null) {
        return `<figure class="cell" style="${box}">${badge(k)}<div class="none" style="${shot}">No separate screen here</div></figure>`;
      }
      const [, title, caption] = spec.steps[i];
      return `<figure class="cell" style="${box}">${badge(k)}<img src="${frames[i].src}" style="${shot}" alt="">`
        + `<figcaption><span class="n">${i + 1}</span> <b>${title}</b> ${caption}</figcaption></figure>`;
    }).join('');
    return `<section class="sheet"><header><h2>${phase.name}</h2><span>${n + 1} of ${rows.length}</span></header><div class="row">${cells}</div></section>`;
  });
  const devices = keys.map((k) => {
    const row = rows.find((r) => r.cells[k] != null);
    const f = row && frames[row.cells[k]];
    return `<li>${badge(k)}${f ? ` <span class="dim">${f.w} × ${f.h} px frames</span>` : ''}</li>`;
  }).join('');
  const phases = spec.phases.map(([name, from, to]) => {
    const states = rows.filter((r) => r.first + 1 >= from && r.first + 1 <= to).length;
    return `<li><b>${name}</b> <span class="dim">${states} screen${states === 1 ? '' : 's'}</span></li>`;
  }).join('');
  const findings = spec.findings.map((f) => `<li><span class="tag ${f.tag}">${f.tag}</span><p><b>${f.title}</b> ${f.body || ''}</p></li>`).join('');
  return `<!DOCTYPE html>
<html lang="en"><meta charset="utf-8"><title>${esc(spec.title.replace(/<[^>]*>/g, ''))}</title>
<style>
@page { size: ${PAGE.width}px ${PAGE.height}px; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; color: #24252A; font: 13px/1.4 "Segoe UI", system-ui, -apple-system, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sheet { width: ${PAGE.width}px; height: ${PAGE.height}px; padding: 28px ${PAGE.pad}px; overflow: hidden; break-after: page; background: #f3f3f4; }
.sheet.flow { height: auto; min-height: ${PAGE.height}px; overflow: visible; }
h1 { font: 500 44px/1.1 Georgia, serif; margin: 40px 0 14px; }
h2 { font: 500 26px/1.2 Georgia, serif; margin: 0; }
header { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 1px solid rgba(36,37,42,.12); padding-bottom: 8px; margin-bottom: 16px; }
header span, .dim { color: #777A84; font-size: 13px; }
.lede { font-size: 16px; color: #434750; max-width: 70ch; }
ul { list-style: none; padding: 0; }
.cover ul li { margin: 6px 0; }
.row { display: flex; gap: ${GAP}px; align-items: flex-start; justify-content: center; }
.cell { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.cell img, .none { display: block; border-radius: 10px; border: 1px solid rgba(36,37,42,.14); background: #fff; box-shadow: 0 6px 18px rgba(0,0,0,.08); }
.none { display: flex; align-items: center; justify-content: center; text-align: center; padding: 16px; color: #777A84; border-style: dashed; background: transparent; box-shadow: none; }
figcaption { font-size: 12px; color: #434750; align-self: stretch; }
figcaption .n { font: 600 12px ui-monospace, Consolas, monospace; color: #1F5F99; }
.who { font: 700 11px/1 "Segoe UI", system-ui, sans-serif; letter-spacing: .05em; text-transform: uppercase; padding: 4px 7px; border-radius: 6px; }
.who.p0 { background: #e2eefa; color: #1F5F99; } .who.p1 { background: #fdf0dc; color: #9a5a08; }
.who.p2 { background: #e3f3e6; color: #2d6b39; } .who.p3 { background: #efe6f8; color: #6a3d99; }
.mono { font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
.findings li { display: grid; grid-template-columns: 80px 1fr; gap: 12px; margin: 0 0 12px; break-inside: avoid; }
.findings p { margin: 0; }
.tag { font: 700 11px/1 "Segoe UI", system-ui, sans-serif; text-transform: uppercase; padding: 4px 7px; border-radius: 6px; background: rgba(36,37,42,.10); color: #434750; height: fit-content; text-align: center; }
.tag.bug { background: #fbe4df; color: #b3361f; } .tag.friction { background: #fbf1df; color: #a96a12; }
.tag.works, .tag.fixed { background: #e1f2e4; color: #2f7a3e; }
</style>
<body>
<section class="sheet cover"><h1>${spec.title}</h1><p class="lede">${spec.lede}</p>
<h2 style="margin-top:28px">Devices</h2><ul>${devices}</ul>
<h2 style="margin-top:20px">Phases</h2><ul>${phases}</ul></section>
${sheets.join('\n')}
${findings ? `<section class="sheet flow"><header><h2>Findings</h2></header><ul class="findings">${findings}</ul></section>` : ''}
</body></html>`;
}

async function main(args) {
  const [flow, outArg] = args;
  if (!flow) throw new Error('usage: node compare-pdf.js <flow> [out.pdf]');
  const dir = caseStudyPaths().flowDir(flow);
  const specPath = path.join(dir, 'writeup.json');
  if (!fs.existsSync(specPath)) throw new Error(`no ${specPath}`);
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const pngs = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
  validate(spec, pngs.length);
  const rows = compareRows(pngs, Object.keys(spec.people));
  const sizes = pngs.map((name) => pngSize(fs.readFileSync(path.join(dir, name))));
  const srcs = await toJpegs(pngs.map((name) => path.join(dir, name)), sizes.map(embedWidth));
  const html = comparePage(spec, rows, sizes.map((s, k) => ({ src: srcs[k], w: s.width, h: s.height })));
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'compare-')), `${flow}.html`);
  fs.writeFileSync(tmp, html);
  const out = path.resolve(outArg || path.join(dir, `${flow}.pdf`));
  // eslint-disable-next-line global-require
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const page = await browser.newPage({ viewport: { width: PAGE.width, height: PAGE.height } });
    await page.goto(pathToFileURL(tmp).href);
    await page.waitForTimeout(500);
    const clipped = await page.evaluate(() => [...document.querySelectorAll('.sheet:not(.flow)')]
      .filter((s) => s.scrollHeight > s.clientHeight + 1)
      .map((s) => (s.querySelector('header span') || s.querySelector('h1')).textContent));
    await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true });
    console.log(`${out} (${rows.length} screens, ${pngs.length} frames, ${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);
    if (clipped.length) console.log(`words run past the foot of: ${clipped.join(', ')} — shorten those captions`);
  } finally {
    await browser.close();
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`compare-pdf: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { compareRows, comparePage, rowLayout, MIN_CELL, MAX_FRAME_HEIGHT };
