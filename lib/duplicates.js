import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { listFiles } from './files.js';

export async function calculateHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

export class DuplicateFinder extends EventEmitter {
  async find(directory) {
    const { root, files } = await listFiles(directory);
    const hashes = new Map();
    let current = 0;
    this.emit('search-start', { directory: root, total: files.length });
    for (const file of files) {
      const stats = await fs.stat(file);
      const hash = await calculateHash(file);
      const group = hashes.get(hash) ?? { hash, size: stats.size, files: [] };
      group.files.push(file);
      hashes.set(hash, group);
      current += 1;
      this.emit('file-processed', { path: file, current, total: files.length });
    }
    const groups = [];
    let totalWasted = 0;
    for (const group of hashes.values()) {
      if (group.files.length > 1) {
        const wastedSize = group.size * (group.files.length - 1);
        groups.push({ ...group, wastedSize });
        totalWasted += wastedSize;
      }
    }
    const result = { directory: root, groups, totalWasted };
    this.emit('duplicates-found', result);
    return result;
  }
}
