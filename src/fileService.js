'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { badRequest, notFound, conflict } = require('./errors');
const { isInside } = require('./security');

const byName = (a, b) => {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la < lb) return -1;
  if (la > lb) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
};

async function lstatOrNull(p) {
  try {
    return await fs.lstat(p);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
    throw err;
  }
}

async function requireExisting(target) {
  const st = await lstatOrNull(target.abs);
  if (!st) throw notFound(target.input);
  return st;
}

function createFileService(guard) {
  async function list(target) {
    const st = await requireExisting(target);
    if (!st.isDirectory()) throw badRequest(`The path '${target.input}' is not a directory.`);

    const entries = await fs.readdir(target.abs, { withFileTypes: true });
    const items = await Promise.all(
      entries.map(async (e) => {
        if (e.isDirectory()) return { name: e.name, type: 'directory', size: 0 };
        const s = await fs.lstat(path.join(target.abs, e.name));
        return { name: e.name, type: 'file', size: s.size };
      })
    );
    const dirs = items.filter((i) => i.type === 'directory').sort((a, b) => byName(a.name, b.name));
    const files = items.filter((i) => i.type === 'file').sort((a, b) => byName(a.name, b.name));
    return [...dirs, ...files];
  }

  async function search(target, query) {
    const st = await requireExisting(target);
    if (!st.isDirectory()) throw badRequest(`The path '${target.input}' is not a directory.`);

    const needle = query.toLowerCase();
    const results = [];
    async function walk(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      await Promise.all(
        entries.map(async (e) => {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) return walk(full); // symlinked dirs are not followed
          if (e.name.toLowerCase().includes(needle)) results.push(guard.toRelative(full));
        })
      );
    }
    await walk(target.abs);
    return results.sort(byName);
  }

  async function prepareTransfer(from, to) {
    if (from.isRoot || to.isRoot) throw badRequest('The base directory itself cannot be a source or destination.');
    const srcStat = await requireExisting(from);
    if (await lstatOrNull(to.abs)) throw conflict(to.input);
    if (srcStat.isDirectory() && isInside(from.abs, to.abs)) {
      throw badRequest('Cannot copy or move a directory into itself.');
    }
    await fs.mkdir(path.dirname(to.abs), { recursive: true });
  }

  async function copy(from, to) {
    await prepareTransfer(from, to);
    await fs.cp(from.abs, to.abs, { recursive: true, errorOnExist: true, force: false });
  }

  async function move(from, to) {
    await prepareTransfer(from, to);
    try {
      await fs.rename(from.abs, to.abs);
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      await fs.cp(from.abs, to.abs, { recursive: true, errorOnExist: true, force: false });
      await fs.rm(from.abs, { recursive: true });
    }
  }

  async function remove(target) {
    if (target.isRoot) throw badRequest('The base directory itself cannot be deleted.');
    await requireExisting(target);
    await fs.rm(target.abs, { recursive: true });
  }

  return { list, search, copy, move, remove };
}

module.exports = { createFileService };
