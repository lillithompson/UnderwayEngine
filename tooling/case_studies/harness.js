'use strict';

/**
 * Headless Chrome over a project's scratch web build, phone-sized and
 * touched by default, or a desktop browser's window driven by a mouse
 * (`open({ device: 'desktop' })`; DEVICES). The page's origin is served
 * from disk and every other host is refused, so nothing reaches production
 * unless the project's `handle` lets it through.
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

/**
 * The Chrome a capture drives: CAPTURE_CHROME where it is set, else where
 * Google installs it on this platform — a Mac's one place, or on Windows
 * the first of the machine's and the user's installs that is there (the
 * machine's when none is, so the error names a real place to look).
 */
function chromePath(platform = process.platform, env = process.env, exists = fs.existsSync) {
  if (env.CAPTURE_CHROME) return env.CAPTURE_CHROME;
  if (platform === 'win32') {
    const installs = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA]
      .filter(Boolean)
      .map((dir) => path.win32.join(dir, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    return installs.find((p) => exists(p)) ?? installs[0];
  }
  if (platform === 'linux') return '/usr/bin/google-chrome';
  return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

const CHROME = chromePath();
const ORIGIN = 'http://localhost:8790';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
/** An iPad's agent in MOBILE content mode, which names the iPad (the
 *  default, desktop mode, says "Macintosh"; an app's WebView may choose
 *  either, and the shell's chooses mobile). */
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

/**
 * The screens a flow is filmed on, in CSS px; `scale` is a frame's pixels
 * per CSS px, so a phone's frames are 1170×2532, an 11-inch iPad's
 * 1640×2360 held upright, a laptop's 2880×1800 and an ultrawide
 * monitor's 3440×1440 (one of those is not a Retina screen). A phone and
 * an iPad are touched (`draw` and `hold` are fingers) and open held
 * upright (`rotate` turns them); the others are a browser window, moused
 * (they are the mouse, and `hover` rests it).
 */
const DEVICES = {
  phone: { width: 390, height: 844, scale: 3, touch: true, ua: IPHONE_UA },
  ipad: { width: 820, height: 1180, scale: 2, touch: true, ua: IPAD_UA },
  ipadPro: { width: 1032, height: 1376, scale: 2, touch: true, ua: IPAD_UA },
  desktop: { width: 1440, height: 900, scale: 2, touch: false, ua: DESKTOP_UA },
  wide: { width: 3440, height: 1440, scale: 1, touch: false, ua: DESKTOP_UA },
};

/** A screen of `size` turned a quarter: held on its side if it stood
 *  upright, upright if it lay on its side. */
function rotated({ width, height }) {
  return { width: height, height: width };
}

/**
 * The screen `resize(to)` makes of a browser opened on `from`: `to` a
 * DEVICES name or { width, height, scale? } (a window dragged, or snapped
 * to part of a monitor). A browser keeps the pixel density it opened with,
 * so a frame can be snapped at that density or at 1× (`shot: 'css'`) and
 * no other; nor can a touched screen become a moused one.
 */
function resized(from, to) {
  const s = typeof to === 'string' ? DEVICES[to] : { ...to, touch: from.touch };
  if (!s) throw new Error(`no device "${to}"; use one of ${Object.keys(DEVICES).join(', ')}`);
  if (s.touch !== from.touch) throw new Error('a touched screen cannot become a moused one: open another browser');
  const scale = s.scale ?? from.scale;
  if (scale !== from.scale && scale !== 1) throw new Error(`frames are ${from.scale}× or 1× in this browser, not ${scale}×`);
  return { width: s.width, height: s.height, shot: scale === from.scale ? 'device' : 'css' };
}

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

/** What `tap` presses, and what `until` waits for (an input too: a field
 *  is waited for by its label, as the Name it step's is). */
const TAPPABLE = '[role=button],button,a,[aria-label],div,span';
const SHOWN = `${TAPPABLE},input`;

/**
 * IN THE PAGE: the visible elements matching `selector` whose label or text
 * is exactly `wanted`, or null for none — the one check `tap` and `until`
 * share. Self-contained, as `evaluate` and `waitForFunction` need: it is
 * run in the page, not here.
 */
function labelled({ wanted, selector }) {
  const els = [...document.querySelectorAll(selector)].filter((e) => {
    const t = (e.getAttribute('aria-label') || e.innerText || '').trim();
    const r = e.getBoundingClientRect();
    return t === wanted && r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0;
  });
  return els.length ? els : null;
}

function createHarness({ rewrites = [], handle = null, signIn = null, web = null } = {}) {
  const webDir = web || process.env.CAPTURE_WEB || path.join(caseStudyPaths().captureDir, 'web');

  async function open({ outDir, device = 'phone', iphone = true, token, startAt = 1 }) {
    const screen = DEVICES[device];
    if (!screen) throw new Error(`no device "${device}"; use one of ${Object.keys(DEVICES).join(', ')}`);
    // eslint-disable-next-line global-require
    const { chromium } = require('playwright-core');
    fs.mkdirSync(outDir, { recursive: true });
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const context = await browser.newContext({
      viewport: { width: screen.width, height: screen.height },
      deviceScaleFactor: screen.scale,
      isMobile: screen.touch,
      hasTouch: screen.touch,
      userAgent: screen.touch && !iphone ? undefined : screen.ua,
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
    let shot = 'device';
    /** The screen's size now, which `resize` and `rotate` change. */
    let size = { width: screen.width, height: screen.height };
    /** The middle of the visible element `tap` would press for `label`. */
    async function middleOf(label) {
      const found = await page.evaluateHandle(labelled, { wanted: label, selector: TAPPABLE });
      const box = await found.evaluate((els) => {
        const e = els && els[els.length - 1];
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await found.dispose();
      if (!box) throw new Error(`no element: ${label}`);
      return box;
    }
    return {
      page, context, browser, refused, errors, device,
      /** Number the next frame `k` (flows that switch between people). */
      frameAt(k) { n = k - 1; },
      async snap(name) {
        await page.waitForTimeout(600);
        n += 1;
        const file = path.join(outDir, `${String(n).padStart(2, '0')}-${name}.png`);
        await page.screenshot({ path: file, scale: shot });
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
      /** A stroke through `points` ([x, y] in CSS px): one finger's real
       *  touch events on a phone, the mouse's button held on a desktop. */
      async draw(points) {
        if (screen.touch) {
          const at = ([x, y]) => [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }];
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(points[0]) });
          for (const p of points.slice(1)) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(p) });
            await page.waitForTimeout(14);
          }
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else {
          await page.mouse.move(...points[0]);
          await page.mouse.down();
          for (const p of points.slice(1)) {
            await page.mouse.move(...p);
            await page.waitForTimeout(14);
          }
          await page.mouse.up();
        }
        await page.waitForTimeout(150);
      },
      /** A finger, or the mouse's button, held still on (x, y) for `ms`: a long press. */
      async hold(x, y, ms = 900) {
        if (screen.touch) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
          await page.waitForTimeout(ms);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else {
          await page.mouse.move(x, y);
          await page.mouse.down();
          await page.waitForTimeout(ms);
          await page.mouse.up();
        }
      },
      /** The window made `to`'s size, the page left as it is (`resized`):
       *  a laptop's flow carried to an ultrawide monitor, or a window
       *  snapped to a third of one. */
      async resize(to) {
        const s = resized(screen, to);
        await page.setViewportSize({ width: s.width, height: s.height });
        shot = s.shot;
        size = { width: s.width, height: s.height };
      },
      /** A phone or an iPad turned a quarter (`rotated`): on a touched
       *  screen the browser's orientation turns with it, so the page sees
       *  `screen.orientation` change and an `orientationchange`, as on a
       *  device. Frames after it are snapped at the turned size. */
      async rotate() {
        await this.resize({ ...rotated(size), scale: shot === 'css' ? 1 : screen.scale });
      },
      /** The mouse rested on the element `tap` would press: its hover state. */
      async hover(label) {
        const { x, y } = await middleOf(label);
        await page.mouse.move(x, y);
      },
      async text() {
        return page.evaluate(() => document.body.innerText.slice(0, 1500));
      },
      /** A real click on the visible element whose text or label is exactly `label`. */
      async tap(label) {
        const { x, y } = await middleOf(label);
        await page.mouse.click(x, y);
      },
      /** Wait until an element — a field too — whose label or text is
       *  exactly `label` shows. */
      async until(label, timeout = 10000) {
        await page.waitForFunction(labelled, { wanted: label, selector: SHOWN }, { timeout });
      },
    };
  }

  return { open, filmstrip, clearFrames, ORIGIN };
}

module.exports = { CHROME, chromePath, DEVICES, ORIGIN, SHOWN, TAPPABLE, clearFrames, createHarness, fileFor, filmstrip, labelled, resized, rotated };
