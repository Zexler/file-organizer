import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { listFiles } from './files.js';

const DAY = 86_400_000;

export class Cleanup extends EventEmitter {
  async run(directory, { olderThan, confirm = false, now = Date.now() } = {}) {
    if (!Number.isFinite(olderThan) || olderThan < 0) {
      throw new Error('older-than must be a finite non-negative number of days');
    }
    const { root, files } = await listFiles(directory);
    const candidates = [];
    for (const file of files) {
      const stats = await fs.stat(file);
      const ageDays = (now - stats.mtimeMs) / DAY;
      if (ageDays > olderThan) {
        const candidate = {
          path: file,
          size: stats.size,
          mtime: stats.mtime,
          mtimeMs: stats.mtimeMs,
          ageDays,
        };
        candidates.push(candidate);
        this.emit('file-found', candidate);
      }
    }
    const result = {
      directory: root,
      dryRun: !confirm,
      candidates,
      totalSize: candidates.reduce((sum, file) => sum + file.size, 0),
      deletedFiles: 0,
      freedSize: 0,
    };
    // EventEmitter listeners run synchronously, so the CLI prints before deletion.
    this.emit('cleanup-preview', result);
    if (confirm) {
      for (const file of candidates) {
        const current = await fs.lstat(file.path);
        const changed = !current.isFile()
          || current.size !== file.size
          || current.mtimeMs !== file.mtimeMs;
        if (changed) {
          throw new Error(`File changed since preview; cleanup stopped: ${file.path}`);
        }
        await fs.unlink(file.path);
        result.deletedFiles += 1;
        result.freedSize += file.size;
        this.emit('file-deleted', { ...file, current: result.deletedFiles, total: candidates.length });
      }
    }
    this.emit('cleanup-complete', result);
    return result;
  }
}
