'use strict';

/**
 * Where a project's case-study captures go. The frames and writeups are
 * documentation, kept out of the project's repository: the directory is
 * `caseStudies` in its underway.config.json (tooling/config.js), and
 * CASE_STUDIES_DIR overrides it for one run. Scratch files (the web build,
 * the built page) go under `<tmp>/<name>-capture`.
 */

const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../config.js');

function projectRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

function caseStudyPaths(root = projectRoot(), env = process.env) {
  const cfg = loadConfig(root);
  const caseStudies = env.CASE_STUDIES_DIR
    ? path.resolve(env.CASE_STUDIES_DIR)
    : path.resolve(root, cfg.caseStudies);
  return {
    root,
    caseStudies,
    /** The folder of one filmed flow: <caseStudies>/flows/<flow>[/<sub>]. */
    flowDir: (...parts) => path.join(caseStudies, 'flows', ...parts),
    captureDir: path.join(env.TMPDIR || os.tmpdir(), `${cfg.name}-capture`),
  };
}

module.exports = { caseStudyPaths, projectRoot };
