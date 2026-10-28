import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArguments } from '../lib/arguments.js';

test('global help and version accept no trailing arguments', () => {
  assert.deepEqual(parseArguments([]), { command: 'help' });
  assert.deepEqual(parseArguments(['--help']), { command: 'help' });
  assert.deepEqual(parseArguments(['--version']), { command: 'version' });
  assert.throws(() => parseArguments(['--help', 'extra']), /does not accept/);
  assert.throws(() => parseArguments(['--version', 'extra']), /does not accept/);
});

test('cleanup accepts zero, fractional days and either option order', () => {
  assert.deepEqual(parseArguments(['cleanup', 'folder with spaces', '--older-than', '0']), {
    command: 'cleanup', directory: 'folder with spaces', olderThan: 0, confirm: false,
  });
  assert.deepEqual(parseArguments(['cleanup', 'folder', '--confirm', '--older-than', '1.5']), {
    command: 'cleanup', directory: 'folder', olderThan: 1.5, confirm: true,
  });
});

test('cleanup rejects missing, non-finite, negative and repeated options', () => {
  const invalid = [
    [], ['--confirm'], ['--older-than'], ['--older-than', '-1'],
    ['--older-than', 'NaN'], ['--older-than', 'Infinity'],
    ['--older-than', '9'.repeat(400)], ['--older-than', '30days'],
    ['--older-than', '30', '--older-than', '40'],
    ['--older-than', '30', '--confirm', '--confirm'],
    ['--older-than', '30', '--unknown'],
  ];
  for (const options of invalid) {
    assert.throws(() => parseArguments(['cleanup', 'folder', ...options]), options.join(' '));
  }
});

test('organize requires one nonempty output and read-only commands reject extra options', () => {
  assert.deepEqual(parseArguments(['organize', 'source', '--output', 'target']), {
    command: 'organize', directory: 'source', output: 'target',
  });
  for (const options of [[], ['--output'], ['--output', ''], ['--output', '--confirm']]) {
    assert.throws(() => parseArguments(['organize', 'source', ...options]), /requires --output/);
  }
  assert.throws(() => parseArguments(['scan', 'folder', '--confirm']), /Unexpected arguments/);
  assert.throws(() => parseArguments(['duplicates', 'folder', '--output', 'target']), /Unexpected arguments/);
  assert.throws(() => parseArguments(['unknown', 'folder']), /Unknown command/);
});
