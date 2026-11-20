'use strict';
/**
 * The engine's own TypeScript, run from plain-node scripts, so a script reads
 * what the app reads with the app's code rather than a copy of it: the case
 * studies (case_studies/build-writeup.js) read a frame's size with
 * imageHeaderSize.ts' pngHeaderSize, and a project's scripts may require this
 * too (DrawBots' scripts/assets/lib reads path data with simplifySVG.ts and a
 * PNG's size with imageHeaderSize.ts).
 *
 * It needs the `typescript` package, which every Underway project has as a
 * dev dependency (it is what `npm run typecheck` runs), and loads it only
 * when a module is first asked for. Node 20 cannot run TypeScript itself.
 */
const fs = require('node:fs');
const path = require('node:path');

const ENGINE_SRC = path.resolve(__dirname, '..', 'packages', 'engine', 'src');

const engineModules = new Map();
/** An engine module's exports (packages/engine/src/<name>.ts): its
 *  TypeScript compiled to CommonJS and run, once per process. It may import
 *  only engine modules beside it (`./name`), which are served the same way —
 *  simplifySVG.ts imports svgPathData.ts, which imports nothing, as
 *  imageHeaderSize.ts does — so anything else it imports throws, naming it.
 *  A type-only import is erased by the compile and never asked for. */
function engineModule(name) {
  let mod = engineModules.get(name);
  if (!mod) {
    const ts = require('typescript');
    const { outputText } = ts.transpileModule(fs.readFileSync(path.join(ENGINE_SRC, `${name}.ts`), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    });
    mod = { exports: {} };
    engineModules.set(name, mod);
    const engineRequire = (request) => {
      const sibling = /^\.\/([A-Za-z0-9_]+)$/.exec(request);
      if (!sibling) throw new Error(`engine-module: the engine's ${name}.ts imports ${request}, which is not served (tooling/engine-module.js)`);
      return engineModule(sibling[1]);
    };
    new Function('exports', 'module', 'require', outputText)(mod.exports, mod, engineRequire);
  }
  return mod.exports;
}

module.exports = { engineModule, ENGINE_SRC };
