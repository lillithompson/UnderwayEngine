'use strict';

/**
 * Phone-sized headless Chrome over a project's scratch web build. The page's
 * origin is served from disk and every other host is refused, so nothing
 * reaches production unless the project's `handle` lets it through.
 *
 * A project's scripts/case_studies/harness.js calls createHarness once with
 * what is its own:
 *
 *   rewrites  [[RegExp, replacement], …] from a route to its exported .html
 *   handle    async (route, url, req) => true when it answered the request
 *             itself: a local API, a stubbed bucket, public content
 *   signIn    async (context, token) => void, for open({ token })
 *   web       the web build (default $CAPTURE_WEB, or <captureDir>/web)
 *
 * playwright-core is not a dependency of anything (`npm i --no-save
 * playwright-core` in the project), so it is required only on opening a
 * browser.
 */

const fs = require('node:fs');
const path = require('node:path');
const { caseStudyPaths } = require('./paths.js');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ORIGIN = 'http://localhost:8790';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

/** The file in the web build that answers `pathname`: itself, itself as
 *  .html, the first rewrite that matches, else the app's index. */
function fileFor(web, rewrites, pathname) {
  const p = decodeURIComponent(pathname);
  const direct = path.join(web, p);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
  if (fs.existsSync(`${direct}.html`)) return `${direct}.html`;
  for (const [re, to] of rewrites) if (re.test(p)) return path.join(web, p.replace(re, to));
  return path.join(web, 'index.html');
}

/**
 * One numbering for a flow's frames across every browser in it. `film(h)`
 * gives that browser's `at(name)`, which snaps the next frame; at frame
 * `stop` it prints what's on screen and ends the run (for building a flow a
 * step at a time).
 */
function filmstrip(stop = Infinity) {
  let frame = 0;
  return (h) => async (name) => {
    frame += 1;
    h.frameAt(frame);
    await h.snap(name);
    if (frame >= stop) {
      console.log(`---- text\n${await h.text()}`);
      console.log(`---- buttons\n${(await h.buttons()).join('\n')}`);
      console.log('errors', h.errors, 'refused', [...h.refused]);
      process.exit(0);
    }
  };
}

/** Delete a flow's old frames before filming. Only the PNGs: the folder also
 *  holds the flow's writeup.json, which a re-capture keeps. */
function clearFrames(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.png')) fs.rmSync(path.join(dir, f));
}

function createHarness({ rewrites = [], handle = null, signIn = null, web = null } = {}) {
  const webDir = web || process.env.CAPTURE_WEB || path.join(caseStudyPaths().captureDir, 'web');

  async function open({ outDir, iphone = true, token, startAt = 1 }) {
    // eslint-disable-next-line global-require
    const { chromium } = require('playwright-core');
    fs.mkdirSync(outDir, { recursive: true });
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      userAgent: iphone ? IPHONE_UA : undefined,
    });
    const refused = new Set();
    await context.route('**/*', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.origin === ORIGIN) {
        const f = fileFor(webDir, rewrites, url.pathname);
        return route.fulfill({ status: 200, body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] ?? 'application/octet-stream' });
      }
      if (handle && await handle(route, url, req)) return undefined;
      if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
      refused.add(url.host);
      return route.abort();
    });
    if (token && signIn) await signIn(context, token);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let n = startAt - 1;
    return {
      page, context, browser, refused, errors,
      /** Number the next frame `k` (flows that switch between people). */
      frameAt(k) { n = k - 1; },
      async snap(name) {
        await page.waitForTimeout(600);
        n += 1;
        const file = path.join(outDir, `${String(n).padStart(2, '0')}-${name}.png`);
        await page.screenshot({ path: file });
        console.log('snap', path.basename(file));
        return file;
      },
      async buttons() {
        return page.evaluate(() =>
          [...document.querySelectorAll('[role=button],button,a,input,[aria-label]')]
            .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; })
            .map((e) => { const r = e.getBoundingClientRect(); return `${e.tagName.toLowerCase()} "${(e.getAttribute('aria-label') || e.innerText || e.placeholder || '').trim().slice(0, 50)}" @${Math.round(r.x + r.width / 2)},${Math.round(r.y + r.height / 2)}`; }),
        );
      },
      /** One finger drawn through `points` ([x, y] in CSS px) as real touch events. */
      async draw(points) {
        const at = ([x, y]) => [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(points[0]) });
        for (const p of points.slice(1)) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(p) });
          await page.waitForTimeout(14);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(150);
      },
      /** A finger held still on (x, y) for `ms`: a long press. */
      async hold(x, y, ms = 900) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
        await page.waitForTimeout(ms);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      },
      async text() {
        return page.evaluate(() => document.body.innerText.slice(0, 1500));
      },
      /** A real click on the visible element whose text or label is exactly `label`. */
      async tap(label) {
        const box = await page.evaluate((wanted) => {
          const els = [...document.querySelectorAll('[role=button],button,a,[aria-label],div,span')].filter((e) => {
            const t = (e.getAttribute('aria-label') || e.innerText || '').trim();
            const r = e.getBoundingClientRect();
            return t === wanted && r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0;
          });
          const e = els[els.length - 1];
          if (!e) return null;
          const r = e.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }, label);
        if (!box) throw new Error(`no element: ${label}`);
        await page.mouse.click(box.x, box.y);
      },
    };
  }

  return { open, filmstrip, clearFrames, ORIGIN };
}

module.exports = { CHROME, ORIGIN, clearFrames, createHarness, fileFor, filmstrip };
