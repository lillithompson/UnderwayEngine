'use strict';

/**
 * The per-project configuration of the shared shipping process
 * (tooling/README.md): `underway.config.json` at the consuming repository's
 * root, read once by review.js, ship.js and check-doc-paths.js. Every field
 * is optional; a repository with no file at all gets the defaults below,
 * which is what the scratch repositories in the tests run on.
 *
 *   name              the project's word, used in prose and as the default
 *                     review-record directory (`<name>-reviews` under .git)
 *   reviewRecords     that directory's name, overriding the default
 *   submodule         where the engine is vendored (vendor/UnderwayEngine)
 *   alwaysReview      regex strings ADDED to the shared always-review list
 *   copySources       a JSON file naming repositories this one copied from
 *                     (review.js "Copies"); absent = no copies
 *   reviewerAddendum  a markdown file of the project's own review checks,
 *                     spliced into the shared reviewer brief
 *   backendSchema     the wire schema a deployed backend shares with the
 *                     app (ship refuses to push a change to it unpushed)
 *   docPaths          check-doc-paths' lists: `docs` (the files it reads),
 *                     `generated` (names correct to write and absent from a
 *                     clean checkout), `prose` (regex strings for words that
 *                     look like paths and are not), `extensions` (source
 *                     extensions a bare name may carry)
 */

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_FILE = 'underway.config.json';

/** Paths whose every change is reviewed regardless of size, in every
 *  project: persistence, the wire schema, the two largest editor files, the
 *  submodule pointer, and the rules and gates themselves. A project adds its
 *  own (its kernel, its design document) through `alwaysReview`. */
function sharedAlwaysReview(cfg) {
  const literal = (p) => new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  const list = [
    /^web\/store\//,
    literal(cfg.backendSchema),
    /^web\/editor\/EditorShell\.tsx$/,
    /^web\/editor\/editorSession\.ts$/,
    literal(cfg.submodule),
    /^CLAUDE\.md$/,
    /^\.claude\//,
    /^\.github\//,
    /^\.githooks\//,
    /^docs\/review\//,
    literal(CONFIG_FILE),
    /^jest\.config\.js$/,
    /^package\.json$/,
  ];
  if (cfg.copySources) list.push(literal(cfg.copySources));
  if (cfg.reviewerAddendum) list.push(literal(cfg.reviewerAddendum));
  return list;
}

const DEFAULT_DOC_PATHS = {
  docs: ['README.md', 'CLAUDE.md'],
  generated: ['ios', 'dist', 'web-bundle', 'node_modules', '.expo', 'expo-env.d.ts'],
  prose: [],
  extensions: [
    '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.yml', '.yaml', '.png',
    '.wav', '.m4a', '.svg', '.patch', '.html', '.css', '.swift', '.sh',
  ],
};

/** The raw file as written, or {} when there is none. A file that does not
 *  parse is an error: a half-written config must not silently become the
 *  defaults. */
function readConfig(root) {
  const file = path.join(root, CONFIG_FILE);
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** The configuration resolved for `root`: every field present, the regex
 *  strings compiled, the shared always-review list first. */
function loadConfig(root) {
  const raw = readConfig(root);
  const name = raw.name || 'project';
  const cfg = {
    name,
    reviewRecords: raw.reviewRecords || `${name}-reviews`,
    submodule: raw.submodule || 'vendor/UnderwayEngine',
    copySources: raw.copySources || null,
    reviewerAddendum: raw.reviewerAddendum || null,
    backendSchema: raw.backendSchema || 'backend/src/validation.ts',
  };
  cfg.alwaysReview = [...sharedAlwaysReview(cfg), ...(raw.alwaysReview || []).map((s) => new RegExp(s))];
  const dp = raw.docPaths || {};
  cfg.docPaths = {
    docs: dp.docs || DEFAULT_DOC_PATHS.docs,
    generated: [...DEFAULT_DOC_PATHS.generated, ...(dp.generated || [])],
    prose: (dp.prose || []).map((s) => new RegExp(s)),
    extensions: [...DEFAULT_DOC_PATHS.extensions, ...(dp.extensions || [])],
  };
  return cfg;
}

module.exports = { CONFIG_FILE, DEFAULT_DOC_PATHS, loadConfig, readConfig, sharedAlwaysReview };
