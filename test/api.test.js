'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');

let server, url, base;

test.before(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'api-'));
  const w = (p, c = 'x') => {
    fs.mkdirSync(path.dirname(path.join(base, p)), { recursive: true });
    fs.writeFileSync(path.join(base, p), c);
  };
  w('documents/report.pdf', '12345');
  w('documents/Notes.txt', 'n');
  w('archive/old_report.pdf', 'o');
  w('readme.txt', 'x'.repeat(1200));
  w('archive.zip', 'zip');
  fs.mkdirSync(path.join(base, 'images'));
  w('source.txt', 'SOURCE');
  w('destination.txt', 'DEST');
  await new Promise((r) => (server = createApp(base).listen(0, r)));
  url = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const call = async (method, p, body) => {
  const res = await fetch(url + p, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

test('GET /files lists root: dirs first, then files, alphabetical', async () => {
  const r = await call('GET', '/files');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map((e) => `${e.type}:${e.name}`), [
    'directory:archive', 'directory:documents', 'directory:images',
    'file:archive.zip', 'file:destination.txt', 'file:readme.txt', 'file:source.txt',
  ]);
  assert.deepEqual(r.body.find((e) => e.name === 'readme.txt'), { name: 'readme.txt', type: 'file', size: 1200 });
  assert.equal(r.body[0].size, 0);
});

test('GET /files?path= lists subdirectory', async () => {
  const r = await call('GET', '/files?path=documents');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map((e) => e.name), ['Notes.txt', 'report.pdf']);
});

test('GET /search finds files recursively', async () => {
  const r = await call('GET', '/search?query=report');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, ['archive/old_report.pdf', 'documents/report.pdf']);
  const scoped = await call('GET', '/search?query=REPORT&path=documents');
  assert.deepEqual(scoped.body, ['documents/report.pdf']);
  assert.deepEqual((await call('GET', '/search?query=zzz')).body, []);
});

test('GET /search requires query', async () => {
  const r = await call('GET', '/search');
  assert.equal(r.status, 400);
  assert.ok(r.body.error.message);
});

test('404 for non-existent paths on every endpoint', async () => {
  const msg = "Not Found: The path 'nope/x.txt' does not exist.";
  for (const [m, p, b] of [
    ['GET', '/files?path=nope/x.txt'],
    ['GET', '/search?query=a&path=nope/x.txt'],
    ['DELETE', '/files?path=nope/x.txt'],
    ['POST', '/files/copy', { from: 'nope/x.txt', to: 'new.txt' }],
    ['POST', '/files/move', { from: 'nope/x.txt', to: 'new.txt' }],
  ]) {
    const r = await call(m, p, b);
    assert.equal(r.status, 404, `${m} ${p}`);
    assert.equal(r.body.error.message, msg);
  }
});

test('403 for traversal and absolute paths on every endpoint', async () => {
  for (const bad of ['../', '../../etc/passwd', '/etc/hosts', 'documents/../../x']) {
    const q = encodeURIComponent(bad);
    for (const [m, p, b] of [
      ['GET', `/files?path=${q}`],
      ['GET', `/search?query=a&path=${q}`],
      ['DELETE', `/files?path=${q}`],
      ['POST', '/files/copy', { from: bad, to: 'x.txt' }],
      ['POST', '/files/copy', { from: 'source.txt', to: bad }],
      ['POST', '/files/move', { from: bad, to: 'x.txt' }],
      ['POST', '/files/move', { from: 'source.txt', to: bad }],
    ]) {
      const r = await call(m, p, b);
      assert.equal(r.status, 403, `${m} ${p} ${JSON.stringify(b)}`);
      assert.equal(r.body.error.message, 'Access denied: Path is outside the allowed directory.');
    }
  }
});

test('copy keeps source, creates destination; 409 on existing destination', async () => {
  let r = await call('POST', '/files/copy', { from: 'source.txt', to: 'copies/copy.txt' });
  assert.equal(r.status, 200);
  assert.equal(r.body.message, "Copied successfully from 'source.txt' to 'copies/copy.txt'");
  assert.equal(fs.readFileSync(path.join(base, 'copies/copy.txt'), 'utf8'), 'SOURCE');
  assert.ok(fs.existsSync(path.join(base, 'source.txt')));

  r = await call('POST', '/files/copy', { from: 'source.txt', to: 'destination.txt' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.message, "Conflict: The destination 'destination.txt' already exists.");
  assert.equal(fs.readFileSync(path.join(base, 'destination.txt'), 'utf8'), 'DEST');
});

test('copy directory recursively', async () => {
  const r = await call('POST', '/files/copy', { from: 'documents', to: 'documents-copy' });
  assert.equal(r.status, 200);
  assert.ok(fs.existsSync(path.join(base, 'documents-copy/report.pdf')));
  assert.ok(fs.existsSync(path.join(base, 'documents/report.pdf')));
});

test('cannot copy/move a directory into itself', async () => {
  assert.equal((await call('POST', '/files/copy', { from: 'documents', to: 'documents/inner' })).status, 400);
  assert.equal((await call('POST', '/files/move', { from: 'documents', to: 'documents/inner' })).status, 400);
});

test('move removes source; 409 on conflict leaves files untouched', async () => {
  fs.writeFileSync(path.join(base, 'm.txt'), 'M');
  let r = await call('POST', '/files/move', { from: 'm.txt', to: 'moved/m2.txt' });
  assert.equal(r.status, 200);
  assert.equal(r.body.message, "Moved successfully from 'm.txt' to 'moved/m2.txt'");
  assert.ok(!fs.existsSync(path.join(base, 'm.txt')));
  assert.equal(fs.readFileSync(path.join(base, 'moved/m2.txt'), 'utf8'), 'M');

  r = await call('POST', '/files/move', { from: 'source.txt', to: 'destination.txt' });
  assert.equal(r.status, 409);
  assert.equal(fs.readFileSync(path.join(base, 'source.txt'), 'utf8'), 'SOURCE');
  assert.equal(fs.readFileSync(path.join(base, 'destination.txt'), 'utf8'), 'DEST');
});

test('delete file and directory', async () => {
  fs.writeFileSync(path.join(base, 'del.txt'), 'd');
  let r = await call('DELETE', '/files?path=del.txt');
  assert.equal(r.status, 200);
  assert.equal(r.body.message, "Deleted successfully: 'del.txt'");
  assert.ok(!fs.existsSync(path.join(base, 'del.txt')));

  r = await call('DELETE', '/files?path=documents-copy');
  assert.equal(r.status, 200);
  assert.ok(!fs.existsSync(path.join(base, 'documents-copy')));
});

test('validation errors return 400 with consistent error shape', async () => {
  for (const r of [
    await call('DELETE', '/files'),
    await call('DELETE', '/files?path='),
    await call('DELETE', '/files?path=.'),
    await call('POST', '/files/copy', { from: 'source.txt' }),
    await call('POST', '/files/move', { from: 1, to: 2 }),
    await call('POST', '/files/copy', '{bad json'),
    await call('GET', '/files?path=a&path=b'),
    await call('GET', '/files?path=readme.txt'),
  ]) {
    assert.equal(r.status, 400);
    assert.equal(typeof r.body.error.message, 'string');
    assert.equal(typeof r.body.error.code, 'string');
  }
});

test('unknown route returns JSON 404', async () => {
  const r = await call('GET', '/nothing');
  assert.equal(r.status, 404);
  assert.ok(r.body.error);
});
