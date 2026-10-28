import fs from 'node:fs/promises';
import path from 'node:path';

async function directoryPath(directory) {
  const absolute = path.resolve(directory);
  const stats = await fs.stat(absolute);
  if (!stats.isDirectory()) {
    const error = new Error(`Expected a directory: ${absolute}`);
    error.code = 'ENOTDIR';
    throw error;
  }
  return fs.realpath(absolute);
}

export async function listFiles(directory) {
  const root = await directoryPath(directory);
  const files = [];
  async function visit(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      // Skip links to avoid following another tree or a directory cycle.
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }
  await visit(root);
  return { root, files };
}
