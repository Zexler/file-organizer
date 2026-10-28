import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Organizer, categories, STREAM_THRESHOLD } from '../lib/organizer.js';
import { calculateHash } from '../lib/duplicates.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'organizer-copy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');
  await fs.mkdir(source);
  return { source, target };
}

test('copies all categories, normalizes extensions and never overwrites collisions', async (t) => {
  const { source, target } = await fixture(t);
  await fs.mkdir(path.join(source, 'nested'));
  for (const [file, content] of [['report.txt', 'first'], ['nested/report.txt', 'second'],
    ['image.PNG', 'image'], ['code.js', 'code'], ['a.zip', 'archive'], ['v.mp4', 'video'], ['unknown', 'other']]) {
    await fs.writeFile(path.join(source, file), content);
  }
  await fs.mkdir(path.join(target, 'Documents'), { recursive: true });
  await fs.writeFile(path.join(target, 'Documents', 'report.txt'), 'keep');
  const organizer = new Organizer();
  const copies = [];
  organizer.on('copy-complete', (event) => copies.push(event));
  const result = await organizer.organize(source, target);
  assert.equal(result.totalFiles, 7);
  assert.equal(result.categories.Documents, 2);
  assert.equal(await fs.readFile(path.join(target, 'Documents/report.txt'), 'utf8'), 'keep');
  assert.deepEqual(new Set(await fs.readdir(path.join(target, 'Documents'))),
    new Set(['report.txt', 'report(1).txt', 'report(2).txt']));
  for (const category of Object.keys(categories)) assert.ok((await fs.stat(path.join(target, category))).isDirectory());
  assert.equal(await fs.readFile(path.join(source, 'report.txt'), 'utf8'), 'first');
  assert.equal(copies.length, 7);
  assert.ok(copies.every((event) => event.method === 'copyFile'));
});

test('uses pipeline at exactly 10 MB and preserves complete binary content', async (t) => {
  const { source, target } = await fixture(t);
  const original = path.join(source, 'large.bin');
  await fs.writeFile(original, Buffer.alloc(STREAM_THRESHOLD, 0x81));
  await fs.mkdir(path.join(target, 'Other'), { recursive: true });
  const existing = path.join(target, 'Other', 'large.bin');
  await fs.writeFile(existing, 'keep existing file');
  const organizer = new Organizer();
  let copied;
  organizer.on('copy-complete', (event) => { copied = event; });
  await organizer.organize(source, target);
  assert.equal(copied.method, 'stream');
  assert.equal(path.basename(copied.destination), 'large(1).bin');
  assert.equal(await fs.readFile(existing, 'utf8'), 'keep existing file');
  assert.equal(await calculateHash(copied.destination), await calculateHash(original));
});

test('a file one byte below 10 MB uses copyFile and keeps its content', async (t) => {
  const { source, target } = await fixture(t);
  const original = path.join(source, 'almost-large.bin');
  await fs.writeFile(original, Buffer.alloc(STREAM_THRESHOLD - 1, 0x42));
  const organizer = new Organizer();
  let copied;
  organizer.on('copy-complete', (event) => { copied = event; });
  await organizer.organize(source, target);
  assert.equal(copied.method, 'copyFile');
  assert.equal(await calculateHash(copied.destination), await calculateHash(original));
});

test('an injected copyFile failure emits copy-error and preserves the original', async (t) => {
  const { source, target } = await fixture(t);
  const original = path.join(source, 'document.txt');
  await fs.writeFile(original, 'keep original');
  const failure = Object.assign(new Error('injected full disk'), { code: 'ENOSPC' });
  t.mock.method(fs, 'copyFile', async () => { throw failure; });
  const organizer = new Organizer();
  let reported;
  organizer.on('copy-error', (event) => { reported = event; });
  await assert.rejects(organizer.organize(source, target), (error) => error === failure);
  assert.equal(reported.error, failure);
  assert.equal(reported.path, path.join(await fs.realpath(source), 'document.txt'));
  assert.equal(await fs.readFile(original, 'utf8'), 'keep original');
});

test('a source removed at copy-start causes stream failure and removes the partial copy', async (t) => {
  const { source, target } = await fixture(t);
  const original = path.join(source, 'large.bin');
  await fs.writeFile(original, Buffer.alloc(STREAM_THRESHOLD));
  const organizer = new Organizer();
  let reported;
  organizer.on('copy-start', () => unlinkSync(original));
  organizer.on('copy-error', ({ error }) => { reported = error; });
  await assert.rejects(organizer.organize(source, target), { code: 'ENOENT' });
  assert.equal(reported.code, 'ENOENT');
  assert.deepEqual(await fs.readdir(path.join(target, 'Other')), []);
});

test('an existing category link outside output is rejected without changing external files', async (t) => {
  const { source, target } = await fixture(t);
  const external = path.join(path.dirname(target), 'external');
  await fs.mkdir(external);
  await fs.mkdir(target);
  await fs.writeFile(path.join(external, 'keep.txt'), 'keep');
  await fs.writeFile(path.join(source, 'document.txt'), 'source');
  await fs.symlink(external, path.join(target, 'Documents'),
    process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(new Organizer().organize(source, target), /Category points outside/);
  assert.deepEqual(await fs.readdir(external), ['keep.txt']);
  assert.equal(await fs.readFile(path.join(external, 'keep.txt'), 'utf8'), 'keep');
});

test('rejects output inside source before creating directories', async (t) => {
  const { source } = await fixture(t);
  const target = path.join(source, 'new', 'output');
  await assert.rejects(new Organizer().organize(source, target), /must not overlap/);
  await assert.rejects(fs.stat(target), { code: 'ENOENT' });
});
