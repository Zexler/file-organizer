import { EventEmitter } from 'node:events';
import path from 'node:path';
import fs from 'node:fs/promises';
import { listFiles } from './files.js';

export class Scanner extends EventEmitter {
  async scan(directory, { now = Date.now() } = {}) {
    const { root, files } = await listFiles(directory);
    this.emit('scan-start', { directory: root, total: files.length });
    const result = {
      directory: root,
      totalFiles: 0,
      totalSize: 0,
      byType: new Map(),
      age: { last7: 0, last30: 0, older90: 0 },
      largestFiles: [],
      oldestFile: null,
    };
    for (const file of files) {
      const stats = await fs.stat(file);
      const data = { path: file, size: stats.size, mtime: stats.mtime };
      result.totalFiles++;
      result.totalSize += data.size;
      const extension = path.extname(file).toLowerCase() || '(no extension)';
      const group = result.byType.get(extension) ?? { count: 0, totalSize: 0 };
      group.count++;
      group.totalSize += data.size;
      result.byType.set(extension, group);
      const days = (now - stats.mtimeMs) / 86_400_000;
      if (days >= 0 && days <= 7) {
        result.age.last7++;
      }
      if (days >= 0 && days <= 30) {
        result.age.last30++;
      }
      if (days > 90) {
        result.age.older90++;
      }
      result.largestFiles.push(data);
      result.largestFiles.sort((a, b) => b.size - a.size || a.path.localeCompare(b.path));
      result.largestFiles = result.largestFiles.slice(0, 3);
      if (!result.oldestFile || data.mtime < result.oldestFile.mtime) {
        result.oldestFile = data;
      }
      this.emit('file-found', { ...data, current: result.totalFiles, total: files.length });
    }
    this.emit('scan-complete', result);
    return result;
  }
}
