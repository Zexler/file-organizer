import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DuplicateFinder, calculateHash } from '../lib/duplicates.js';

test('groups identical contents across names and counts only extra copies', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'organizer-duplicates-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'nested'));
  for (const name of ['a.txt', 'b.bin', 'nested/c.txt']) await fs.writeFile(path.join(root, name), 'same');
  await fs.writeFile(path.join(root, 'different.txt'), 'diff');
  const finder = new DuplicateFinder();
  const processed = [];
  finder.on('file-processed', (event) => processed.push(event.current));
  let completed;
  finder.on('duplicates-found', (result) => { completed = result; });
  const result = await finder.find(root);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].files.length, 3);
  assert.equal(result.groups[0].hash, createHash('sha256').update('same').digest('hex'));
  assert.equal(result.totalWasted, 8);
  assert.deepEqual(processed, [1, 2, 3, 4]);
  assert.equal(completed, result);
});

test('stream hashing handles a file larger than 10 MB and missing input', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'organizer-hash-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const data = Buffer.alloc(11 * 1024 * 1024, 0xab);
  const file = path.join(root, 'large.bin');
  await fs.writeFile(file, data);
  assert.equal(await calculateHash(file), createHash('sha256').update(data).digest('hex'));
  await assert.rejects(calculateHash(path.join(root, 'missing')), { code: 'ENOENT' });
});
