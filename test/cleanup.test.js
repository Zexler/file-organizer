import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Cleanup } from '../lib/cleanup.js';

const cli = fileURLToPath(new URL('../file-organizer.js', import.meta.url));
const DAY = 86_400_000;

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'organizer-cleanup-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const now = Date.UTC(2026, 0, 1);
  await fs.mkdir(path.join(root, 'nested'));
  for (const [name, age] of [['nested/old.txt', 31], ['boundary.txt', 30], ['recent.txt', 1]]) {
    const file = path.join(root, name);
    await fs.writeFile(file, name);
    const date = new Date(now - age * DAY);
    await fs.utimes(file, date, date);
  }
  return { root, now };
}

test('dry run lists only strictly older files and never deletes', async (t) => {
  const { root, now } = await fixture(t);
  const cleanup = new Cleanup();
  const events = [];
  cleanup.on('file-found', () => events.push('found'));
  cleanup.on('cleanup-preview', () => events.push('preview'));
  cleanup.on('file-deleted', () => events.push('deleted'));
  cleanup.on('cleanup-complete', () => events.push('complete'));
  const result = await cleanup.run(root, { olderThan: 30, now });
  assert.equal(result.dryRun, true);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.totalSize, Buffer.byteLength('nested/old.txt'));
  assert.equal(result.deletedFiles, 0);
  assert.deepEqual(events, ['found', 'preview', 'complete']);
  assert.equal(await fs.readFile(path.join(root, 'nested/old.txt'), 'utf8'), 'nested/old.txt');
});

test('confirmed cleanup previews before deleting and preserves boundary and recent files', async (t) => {
  const { root, now } = await fixture(t);
  const cleanup = new Cleanup();
  const events = [];
  cleanup.on('cleanup-preview', () => events.push('preview'));
  cleanup.on('file-deleted', () => events.push('deleted'));
  const result = await cleanup.run(root, { olderThan: 30, now, confirm: true });
  assert.deepEqual(events, ['preview', 'deleted']);
  assert.equal(result.deletedFiles, 1);
  assert.equal(result.freedSize, Buffer.byteLength('nested/old.txt'));
  await assert.rejects(fs.access(path.join(root, 'nested/old.txt')), { code: 'ENOENT' });
  await fs.access(path.join(root, 'boundary.txt'));
  await fs.access(path.join(root, 'recent.txt'));
});

test('changed candidates stop cleanup without deleting the modified file', async (t) => {
  const { root, now } = await fixture(t);
  const cleanup = new Cleanup();
  cleanup.on('cleanup-preview', () => {
    writeFileSync(path.join(root, 'nested/old.txt'), 'updated content');
  });
  await assert.rejects(cleanup.run(root, { olderThan: 30, now, confirm: true }), /File changed/);
  assert.equal(await fs.readFile(path.join(root, 'nested/old.txt'), 'utf8'), 'updated content');
});

test('cleanup preserves the candidate when unlink is injected to fail', async (t) => {
  const { root, now } = await fixture(t);
  const failure = Object.assign(new Error('injected deletion failure'), { code: 'EACCES' });
  t.mock.method(fs, 'unlink', async () => { throw failure; });
  const cleanup = new Cleanup();
  let deleted = false;
  cleanup.on('file-deleted', () => { deleted = true; });
  await assert.rejects(cleanup.run(root, { olderThan: 30, now, confirm: true }),
    (error) => error === failure);
  assert.equal(deleted, false);
  assert.equal(await fs.readFile(path.join(root, 'nested/old.txt'), 'utf8'), 'nested/old.txt');
});

test('CLI defaults to preview, rejects unsafe arguments and reports missing directories', async (t) => {
  const { root } = await fixture(t);
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const preview = run('cleanup', root, '--older-than', '30');
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /DRY RUN/);
  await fs.access(path.join(root, 'nested/old.txt'));
  for (const options of [[], ['--older-than', '-1'], ['--older-than', 'NaN'],
    ['--older-than', 'Infinity'], ['--older-than', '30', '--unknown'], ['--confirm']]) {
    const invalid = run('cleanup', root, ...options);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /Error:/);
  }
  const missing = run('scan', path.join(root, 'missing'));
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /not found/);
});
