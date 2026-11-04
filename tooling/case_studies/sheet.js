#!/usr/bin/env node
'use strict';

// Contact sheet of a flow's frames, for a quick look: node sheet.js <flowDir> <out.png> [from] [to]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { CHROME } = require('./harness.js');

(async () => {
  const dir = path.resolve(process.argv[2]);
  const from = Number(process.argv[4] ?? 1);
  const to = Number(process.argv[5] ?? 99);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort().filter((f) => { const n = parseInt(f, 10); return n >= from && n <= to; });
  const html = `<body style="margin:0;background:#888;display:grid;grid-template-columns:repeat(${Math.min(files.length, 6)},1fr);gap:8px;padding:8px">${files.map((f) => `<div style="font:12px sans-serif;color:#fff"><img src="file://${dir}/${f}" style="width:100%;display:block">${f}</div>`).join('')}</body>`;
  const tmp = path.join(os.tmpdir(), 'sheet.html');
  fs.writeFileSync(tmp, html);
  const b = await chromium.launch({ executablePath: CHROME });
  const p = await b.newPage({ viewport: { width: 300 * Math.min(files.length, 6), height: 700 } });
  await p.goto(`file://${tmp}`);
  await p.waitForTimeout(800);
  await p.screenshot({ path: process.argv[3], fullPage: true });
  await b.close();
})();
