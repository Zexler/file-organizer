export const help = `File Organizer CLI

Usage:
  node file-organizer.js scan <directory>
  node file-organizer.js duplicates <directory>
  node file-organizer.js organize <source> --output <target>
  node file-organizer.js cleanup <directory> --older-than <days> [--confirm]

cleanup previews files by default; --confirm permanently deletes them.
Paths with spaces must be quoted.
Options: --help, --version`;

function parseCleanup(options) {
  let olderThan;
  let confirm = false;
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === '--confirm' && !confirm) {
      confirm = true;
      continue;
    }
    if (option === '--older-than' && olderThan === undefined) {
      index += 1;
      const value = options[index];
      if (!value || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
        throw new Error('--older-than requires a non-negative number of days');
      }
      olderThan = Number(value);
      if (!Number.isFinite(olderThan)) {
        throw new Error('--older-than requires a finite number of days');
      }
      continue;
    }
    throw new Error(`Unexpected cleanup argument: ${option}`);
  }
  if (olderThan === undefined) {
    throw new Error('cleanup requires --older-than <days>');
  }
  return { olderThan, confirm };
}

export function parseArguments(args) {
  if (args.length === 0) {
    return { command: 'help' };
  }
  const [command, directory, ...options] = args;
  if (command === '--help' || command === '--version') {
    if (args.length !== 1) {
      throw new Error(`${command} does not accept additional arguments`);
    }
    return { command: command === '--help' ? 'help' : 'version' };
  }
  if (!['scan', 'duplicates', 'organize', 'cleanup'].includes(command)) {
    throw new Error(`Unknown command: ${command}\n${help}`);
  }
  if (!directory || directory.startsWith('--')) {
    throw new Error(`Expected a directory.\n${help}`);
  }
  if (command === 'cleanup') {
    return { command, directory, ...parseCleanup(options) };
  }
  if (command === 'organize') {
    const [flag, output] = options;
    if (options.length !== 2 || flag !== '--output' || !output || output.startsWith('--')) {
      throw new Error(`organize requires --output <target>.\n${help}`);
    }
    return { command, directory, output };
  }
  if (options.length > 0) {
    throw new Error(`Unexpected arguments: ${options.join(' ')}\n${help}`);
  }
  return { command, directory };
}
