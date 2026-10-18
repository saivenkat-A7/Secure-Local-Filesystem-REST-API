'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { badRequest, forbidden } = require('./errors');

function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

/**
 * Creates a guard that resolves user-supplied relative paths against baseDir
 * and guarantees the result cannot escape it (lexically or via symlinks).
 */
function createPathGuard(baseDir) {
  const base = path.resolve(baseDir);
  let realBase;
  const getRealBase = async () => (realBase ??= await fs.realpath(base));

  async function assertRealInside(abs) {
    const root = await getRealBase();
    let current = abs;
    for (;;) {
      try {
        const real = await fs.realpath(current);
        if (!isInside(root, real)) throw forbidden();
        return;
      } catch (err) {
        if (err.name === 'ApiError') throw err;
        if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
          // A dangling symlink is unsafe: writing through it could escape the sandbox.
          try {
            if ((await fs.lstat(current)).isSymbolicLink()) throw forbidden();
          } catch (inner) {
            if (inner.name === 'ApiError') throw inner;
          }
          const parent = path.dirname(current);
          if (parent === current) return;
          current = parent;
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * @param {unknown} input user-supplied path (relative to base). Omitted/empty => base itself.
   * @returns {Promise<{abs: string, input: string, isRoot: boolean}>}
   */
  async function resolve(input = '') {
    if (typeof input !== 'string') throw badRequest('Path must be a string.');
    if (input.includes('\0')) throw badRequest('Path contains invalid characters.');
    if (path.posix.isAbsolute(input) || path.win32.isAbsolute(input)) throw forbidden();

    const abs = path.resolve(base, input);
    if (!isInside(base, abs)) throw forbidden();
    await assertRealInside(abs);
    return { abs, input, isRoot: abs === base };
  }

  const toRelative = (abs) => path.relative(base, abs).split(path.sep).join('/');

  return { base, resolve, toRelative, isInside };
}

module.exports = { createPathGuard, isInside };
