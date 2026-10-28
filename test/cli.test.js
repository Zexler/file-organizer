import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../file-organizer.js', import.meta.url));

function run(...args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

test('CLI scans, finds duplicates and copies files when paths contain spaces', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'organizer cli '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source files');
  const output = path.join(root, 'sorted files');
  await fs.mkdir(path.join(source, 'nested'), { recursive: true });
  await fs.writeFile(path.join(source, 'one.txt'), 'same');
  await fs.writeFile(path.join(source, 'nested', 'two.txt'), 'same');
  await fs.writeFile(path.join(source, 'image.PNG'), 'picture');

  const scan = run('scan', source);
  assert.equal(scan.status, 0, scan.stderr);
  assert.match(scan.stdout, /Total files: 3/);
  assert.match(scan.stdout, /Total size: 15 B/);
  const invalid = run('scan', path.join(source, 'one.txt'));
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stderr.split('Expected a directory').length - 1, 1);
  const duplicates = run('duplicates', source);
  assert.equal(duplicates.status, 0, duplicates.stderr);
  assert.match(duplicates.stdout, /Found 1 duplicate groups/);
  assert.match(duplicates.stdout, /Total wasted space: 4 B/);
  const organize = run('organize', source, '--output', output);
  assert.equal(organize.status, 0, organize.stderr);
  assert.match(organize.stdout, /Total copied: 3 files, 15 B/);
  assert.equal(await fs.readFile(path.join(output, 'Documents', 'two.txt'), 'utf8'), 'same');
  assert.equal(await fs.readFile(path.join(output, 'Images', 'image.PNG'), 'utf8'), 'picture');
  assert.equal(await fs.readFile(path.join(source, 'one.txt'), 'utf8'), 'same');
});

test('CLI cleanup previews by default and prints a warning before its deletion summary', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'organizer-cleanup-cli-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const old = path.join(root, 'old.txt');
  const fresh = path.join(root, 'fresh.txt');
  await fs.writeFile(old, 'old content');
  await fs.writeFile(fresh, 'keep');
  const date = new Date(Date.now() - 40 * 86_400_000);
  await fs.utimes(old, date, date);

  const preview = run('cleanup', root, '--older-than', '30');
  assert.equal(preview.status, 0, preview.stderr);
  assert.ok(preview.stdout.includes(old));
  assert.ok(!preview.stdout.includes(fresh));
  assert.match(preview.stdout, /DRY RUN/);
  assert.equal(await fs.readFile(old, 'utf8'), 'old content');

  const confirmed = run('cleanup', root, '--older-than', '30', '--confirm');
  assert.equal(confirmed.status, 0, confirmed.stderr);
  const warning = confirmed.stdout.indexOf('WARNING:');
  const summary = confirmed.stdout.indexOf('Deleted: 1 files. Freed: 11 B');
  assert.ok(confirmed.stdout.indexOf(old) < warning);
  assert.ok(warning >= 0 && summary > warning);
  await assert.rejects(fs.access(old), { code: 'ENOENT' });
  assert.equal(await fs.readFile(fresh, 'utf8'), 'keep');
});
