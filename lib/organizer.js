import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { createReadStream, constants } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { listFiles } from './files.js';

export const STREAM_THRESHOLD = 10 * 1024 * 1024;
export const categories = {
  Documents: ['.pdf', '.docx', '.doc', '.txt', '.md', '.xlsx', '.pptx'],
  Images: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp'],
  Archives: ['.zip', '.rar', '.tar', '.gz', '.7z'],
  Code: ['.js', '.py', '.java', '.cpp', '.html', '.css', '.json'],
  Videos: ['.mp4', '.avi', '.mkv', '.mov', '.webm'],
  Other: [],
};

export function categoryFor(file) {
  const extension = path.extname(file).toLowerCase();
  for (const [category, extensions] of Object.entries(categories)) {
    if (extensions.includes(extension)) {
      return category;
    }
  }
  return 'Other';
}

function contains(parent, child) {
  const relative = path.relative(parent, child);
  if (relative === '') {
    return true;
  }
  const outside = relative === '..' || relative.startsWith(`..${path.sep}`);
  return !outside && !path.isAbsolute(relative);
}

async function canonicalTarget(target) {
  try {
    return await fs.realpath(target);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    // Resolve the existing ancestor before appending folders not created yet.
    const parent = path.dirname(target);
    if (parent === target) {
      throw error;
    }
    return path.join(await canonicalTarget(parent), path.basename(target));
  }
}

async function copyExclusive(source, destination, size) {
  if (size < STREAM_THRESHOLD) {
    await fs.copyFile(source, destination, constants.COPYFILE_EXCL);
    return 'copyFile';
  }
  // Opening exclusively proves that a failed copy owns the partial destination.
  const handle = await fs.open(destination, 'wx');
  try {
    await pipeline(createReadStream(source), handle.createWriteStream());
    return 'stream';
  } catch (error) {
    try {
      await handle.close();
    } catch (closeError) {
      error.message += `; could not close partial copy: ${closeError.message}`;
    }
    try {
      await fs.unlink(destination);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') {
        error.message += `; could not remove partial copy ${destination}: ${cleanupError.message}`;
      }
    }
    throw error;
  }
}

async function copyWithAvailableName(source, folder, size) {
  const extension = path.extname(source);
  const stem = path.basename(source, extension);
  let suffix = 0;
  while (true) {
    const name = suffix === 0 ? `${stem}${extension}` : `${stem}(${suffix})${extension}`;
    const destination = path.join(folder, name);
    try {
      const method = await copyExclusive(source, destination, size);
      return { destination, method };
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
      suffix += 1;
    }
  }
}

export class Organizer extends EventEmitter {
  async organize(source, output) {
    const { root, files } = await listFiles(source);
    const target = await canonicalTarget(path.resolve(output));
    if (contains(root, target) || contains(target, root)) {
      throw new Error('Source and output directories must not overlap. Choose a separate output directory.');
    }
    const result = {
      directory: root,
      target,
      totalFiles: 0,
      totalSize: 0,
      categories: Object.fromEntries(Object.keys(categories).map((category) => [category, 0])),
    };
    for (const category of Object.keys(categories)) {
      const folder = path.join(target, category);
      await fs.mkdir(folder, { recursive: true });
      // Existing category links must not redirect writes outside the output tree.
      const resolved = await fs.realpath(folder);
      if (!contains(target, resolved)) {
        throw new Error(`Category points outside output directory: ${folder}`);
      }
    }
    this.emit('organize-start', { directory: root, target, total: files.length });
    for (const file of files) {
      const stats = await fs.stat(file);
      const category = categoryFor(file);
      this.emit('copy-start', { path: file, size: stats.size });
      try {
        const folder = path.join(target, category);
        const copy = await copyWithAvailableName(file, folder, stats.size);
        result.totalFiles += 1;
        result.totalSize += stats.size;
        result.categories[category] += 1;
        this.emit('copy-complete', {
          path: file,
          ...copy,
          current: result.totalFiles,
          total: files.length,
        });
      } catch (error) {
        this.emit('copy-error', { path: file, error });
        throw error;
      }
    }
    this.emit('organize-complete', result);
    return result;
  }
}
