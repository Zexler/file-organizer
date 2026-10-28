import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Scanner } from '../lib/scanner.js';
import { formatError } from '../lib/display.js';

test('recursive scan reports sizes, types, age boundaries and ordered events', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'organizer-scan-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'nested'));
  const now = Date.now();
  const fixtures = [['one.TXT', 4, 7], ['nested/two.txt', 8, 30], ['old', 2, 91], ['recent.js', 12, 1]];
  for (const [name, size, age] of fixtures) {
    const file = path.join(root, name);
    await fs.writeFile(file, Buffer.alloc(size));
    const date = new Date(now - age * 86_400_000);
    await fs.utimes(file, date, date);
  }
  const scanner = new Scanner();
  const events = [];
  scanner.on('scan-start', () => events.push('start'));
  scanner.on('file-found', (data) => events.push(data.current));
  scanner.on('scan-complete', () => events.push('complete'));
  const result = await scanner.scan(root, { now });
  assert.equal(result.totalFiles, 4);
  assert.equal(result.totalSize, 26);
  assert.deepEqual(result.byType.get('.txt'), { count: 2, totalSize: 12 });
  assert.deepEqual(result.age, { last7: 2, last30: 3, older90: 1 });
  assert.deepEqual(result.largestFiles.map((file) => file.size), [12, 8, 4]);
  assert.equal(result.oldestFile.path, path.join(await fs.realpath(root), 'old'));
  assert.deepEqual(events, ['start', 1, 2, 3, 4, 'complete']);
});

test('empty directories produce an empty report', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'organizer-empty-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await new Scanner().scan(root);
  assert.equal(result.totalFiles, 0);
  assert.equal(result.oldestFile, null);
  assert.deepEqual(result.largestFiles, []);
});

test('scanner preserves ENOENT for a real missing directory', async () => {
  await assert.rejects(new Scanner().scan(path.join(os.tmpdir(), `missing-${crypto.randomUUID()}`)),
    { code: 'ENOENT' });
});

test('formatter explains system errors without repeating an existing explanation', () => {
  const error = Object.assign(new Error('read directory /restricted'), { code: 'EACCES' });
  assert.equal(formatError(error), 'Permission denied: read directory /restricted');
  const directoryError = Object.assign(new Error('Expected a directory: /file.txt'), { code: 'ENOTDIR' });
  assert.equal(formatError(directoryError), 'Expected a directory: /file.txt');
});

test('scanner propagates an injected readdir failure without a completion event', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'organizer-denied-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const denied = Object.assign(new Error('injected directory read failure'), { code: 'EACCES' });
  t.mock.method(fs, 'readdir', async () => { throw denied; });
  const scanner = new Scanner();
  let completed = false;
  scanner.on('scan-complete', () => { completed = true; });
  await assert.rejects(scanner.scan(root), (error) => error === denied);
  assert.equal(completed, false);
});

test('scanner skips directory links to an external folder and back to its root', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'organizer-links-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'source');
  const external = path.join(temporary, 'external');
  await fs.mkdir(root);
  await fs.mkdir(external);
  await fs.writeFile(path.join(root, 'inside.txt'), 'inside');
  await fs.writeFile(path.join(external, 'outside.txt'), 'outside');
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  await fs.symlink(external, path.join(root, 'external-link'), type);
  await fs.symlink(root, path.join(root, 'cycle'), type);
  const result = await new Scanner().scan(root);
  assert.equal(result.totalFiles, 1);
  assert.equal(result.totalSize, 6);
});
