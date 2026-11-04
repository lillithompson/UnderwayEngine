#!/usr/bin/env node
'use strict';

// Builds a flow's writeup page from its frames and its spec, both in the
// flow's folder (paths.js):
//   <caseStudies>/flows/<flow>/*.png   (in filename order: 01-…, 02-…)
//   <caseStudies>/flows/<flow>/writeup.json
// into one self-contained HTML file (frames embedded as 693px JPEGs), ready
// to publish as an artifact. Run it from inside the project:
//
//   node vendor/UnderwayEngine/tooling/case_studies/build-writeup.js <flow> [out.html] [--check]
//
// out.html defaults to <captureDir>/<flow>-flow.html. --check renders the
// page at 1100 and 390 px wide in headless Chrome, prints whether every frame
// loaded and whether the page scrolls sideways, and saves a full-page
// screenshot of each beside out.html.
//
// writeup.json:
//   flow     the folder name, e.g. "group-creature"
//   title    two to four words, e.g. "Group Creature Flow"
//   lede     who does what, and "Captured from current main on <date>."
//   people   { key: "Name" } in badge order (blue, amber, green, purple)
//   phases   [[name, firstFrame, lastFrame], …] covering every frame once, in order
//   steps    [[personKey or "", title, caption], …] one per frame
//   hint     optional, after "Full-size 3× PNGs are in …"
//   findings [{ tag, title, body }], tag one of bug friction polish check works fixed
//   setup    ["paragraph", …] for "How this was captured"
//   artifact the published page's URL, once it has one
// Every text field is inline HTML (<b>, <span class="mono">).
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CHROME } = require('./harness.js');
const { caseStudyPaths } = require('./paths.js');

const TAGS = ['bug', 'friction', 'polish', 'check', 'works', 'fixed'];
const FRAME_WIDTH = 693;
const MAX_BYTES = 15 * 1024 * 1024;

/** Throws on a spec whose steps, phases, people or tags don't fit the frames. */
function validate(spec, frameCount) {
  for (const k of ['flow', 'title', 'lede', 'people', 'phases', 'steps', 'findings', 'setup']) {
    if (spec[k] == null) throw new Error(`writeup.json has no "${k}"`);
  }
  if (spec.steps.length !== frameCount) {
    throw new Error(`${spec.steps.length} steps for ${frameCount} frames: one step per PNG`);
  }
  let next = 1;
  for (const [name, from, to] of spec.phases) {
    if (from !== next || to < from) throw new Error(`phase "${name}" is ${from}–${to}; expected it to start at ${next}`);
    next = to + 1;
  }
  if (next !== frameCount + 1) throw new Error(`phases end at ${next - 1}, but there are ${frameCount} frames`);
  spec.steps.forEach(([who], i) => {
    if (who && !(who in spec.people)) throw new Error(`step ${i + 1} names "${who}", who isn't in people`);
  });
  spec.findings.forEach((f, i) => {
    if (!TAGS.includes(f.tag)) throw new Error(`finding ${i + 1} has tag "${f.tag}"; use one of ${TAGS.join(', ')}`);
  });
}

function embedFrames(dir, pngs) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'writeup-'));
  try {
    return pngs.map((name) => {
      const out = path.join(tmp, name.replace(/\.png$/, '.jpg'));
      execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '72',
        '--resampleWidth', String(FRAME_WIDTH), path.join(dir, name), '--out', out], { stdio: 'ignore' });
      return `data:image/jpeg;base64,${fs.readFileSync(out).toString('base64')}`;
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// JSON inside a <script>: keep "</script>" and U+2028/9 from ending or breaking it.
function scriptJson(value) {
  return JSON.stringify(value).replace(/<\//g, '<\\/').replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
}

/** The template filled in. `framesDir` is what the page says the PNGs' folder is. */
function fillTemplate(template, spec, framesDir, frames) {
  return template
    .replace('__TITLE__', () => spec.title.replace(/</g, '&lt;'))
    .replace('__DATA__', () => scriptJson({ ...spec, framesDir }))
    .replace('__FRAMES__', () => scriptJson(frames));
}

async function check(out) {
  // eslint-disable-next-line global-require
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [1100, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`file://${out}`);
      await page.waitForTimeout(800);
      const info = await page.evaluate(() => ({
        frames: document.images.length,
        loaded: [...document.images].filter((i) => i.complete && i.naturalWidth).length,
        scrollsSideways: document.documentElement.scrollWidth > innerWidth,
      }));
      const shot = out.replace(/\.html$/, `.check-${width}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      console.log(`${width}px: ${info.loaded}/${info.frames} frames loaded, scrolls sideways: ${info.scrollsSideways}${errors.length ? `, script errors: ${errors.join('; ')}` : ''}\n  ${shot}`);
    }
  } finally {
    await browser.close();
  }
}

async function main(args) {
  const wantCheck = args.includes('--check');
  const [flow, outArg] = args.filter((a) => a !== '--check');
  if (!flow) throw new Error('usage: node build-writeup.js <flow> [out.html] [--check]');

  const paths = caseStudyPaths();
  const dir = paths.flowDir(flow);
  const specPath = path.join(dir, 'writeup.json');
  if (!fs.existsSync(specPath)) throw new Error(`no ${path.relative(process.cwd(), specPath)}`);
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const pngs = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
  validate(spec, pngs.length);

  const template = fs.readFileSync(path.join(__dirname, 'writeup.template.html'), 'utf8');
  const html = fillTemplate(template, spec, `${path.relative(paths.root, dir)}/`, embedFrames(dir, pngs));
  const out = path.resolve(outArg || path.join(paths.captureDir, `${flow}-flow.html`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  const mb = (Buffer.byteLength(html) / 1024 / 1024).toFixed(1);
  console.log(`${out} (${pngs.length} frames, ${mb} MB)`);
  if (Buffer.byteLength(html) > MAX_BYTES) throw new Error(`${mb} MB is over the 15 MB budget for an artifact; keep fewer frames`);
  if (wantCheck) await check(out);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`build-writeup: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { fillTemplate, scriptJson, validate };
