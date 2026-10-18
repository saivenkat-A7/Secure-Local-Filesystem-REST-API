'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPathGuard } = require('../src/security');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
fs.mkdirSync(path.join(base, 'sub'));
fs.symlinkSync(outside, path.join(base, 'escape'));
fs.symlinkSync(path.join(outside, 'nope'), path.join(base, 'dangling'));
const guard = createPathGuard(base);

test('resolves inside paths', async () => {
  assert.equal((await guard.resolve('sub/a.txt')).abs, path.join(base, 'sub', 'a.txt'));
  assert.equal((await guard.resolve('sub/../sub')).abs, path.join(base, 'sub'));
  assert.equal((await guard.resolve()).isRoot, true);
  assert.equal((await guard.resolve('.')).isRoot, true);
});

for (const bad of ['../', '../../etc/passwd', 'sub/../../x', '/etc/hosts', '..', 'C:\\Windows', 'escape/file', 'dangling']) {
  test(`rejects ${bad}`, async () => {
    await assert.rejects(guard.resolve(bad), (e) => e.status === 403);
  });
}

test('rejects sibling directory with same prefix', async () => {
  await assert.rejects(guard.resolve('../' + path.basename(base) + '-evil/x'), (e) => e.status === 403);
});

test('rejects null bytes and non-strings with 400', async () => {
  await assert.rejects(guard.resolve('a\0b'), (e) => e.status === 400);
  await assert.rejects(guard.resolve(['a']), (e) => e.status === 400);
});
