const errorMessages = {
  ENOENT: 'File or directory not found',
  EACCES: 'Permission denied',
  EPERM: 'Operation not permitted',
  ENOTDIR: 'Expected a directory',
  EISDIR: 'Expected a regular file',
  EEXIST: 'Destination already exists',
  ENOSPC: 'No space left on device',
};

export function formatError(error) {
  const explanation = errorMessages[error.code];
  if (!explanation) {
    return error.message;
  }
  if (error.message === explanation || error.message.startsWith(`${explanation}:`)) {
    return error.message;
  }
  return `${explanation}: ${error.message}`;
}

export function formatSize(bytes) {
  if (bytes === 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

export function progress(current, total, label = 'Processing') {
  if (!process.stdout.isTTY) {
    return;
  }
  const filled = total ? Math.round(current / total * 20) : 20;
  process.stdout.write(`\r${label} [${'#'.repeat(filled)}${'.'.repeat(20 - filled)}] ${current}/${total}`);
  if (current === total) {
    process.stdout.write('\n');
  }
}

export function printScan(result) {
  console.log(`\nScan results: ${result.directory}`);
  console.log(`Total files: ${result.totalFiles}\nTotal size: ${formatSize(result.totalSize)}`);
  console.log('\nBy file type:');
  for (const [extension, data] of [...result.byType].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${extension.padEnd(16)} ${String(data.count).padStart(5)} files  ${formatSize(data.totalSize)}`);
  }
  console.log(`\nFile age (mtime):\n  Last 7 days: ${result.age.last7}\n  Last 30 days: ${result.age.last30}\n  Older than 90 days: ${result.age.older90}`);
  console.log('\nLargest files:');
  for (const file of result.largestFiles) {
    console.log(`  ${formatSize(file.size).padStart(12)}  ${file.path}`);
  }
  const oldest = result.oldestFile;
  const description = oldest ? `${oldest.path} (${oldest.mtime.toISOString()})` : 'none';
  console.log(`\nOldest file: ${description}`);
}
