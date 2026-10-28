#!/usr/bin/env node
import { Scanner } from './lib/scanner.js';
import { DuplicateFinder } from './lib/duplicates.js';
import { Organizer } from './lib/organizer.js';
import { Cleanup } from './lib/cleanup.js';
import { help, parseArguments } from './lib/arguments.js';
import {
  progress,
  printScan,
  printDuplicates,
  printOrganization,
  printCleanupFile,
  printCleanupPreview,
  printCleanupResult,
  formatError,
} from './lib/display.js';

async function runScan(directory) {
  const scanner = new Scanner();
  scanner.on('scan-start', ({ directory, total }) => {
    console.log(`Scanning: ${directory}`);
    progress(0, total);
  });
  scanner.on('file-found', ({ current, total }) => progress(current, total));
  scanner.on('scan-complete', printScan);
  await scanner.scan(directory);
}

async function runDuplicates(directory) {
  const finder = new DuplicateFinder();
  finder.on('search-start', ({ directory, total }) => {
    console.log(`Searching for duplicates: ${directory}`);
    progress(0, total, 'Hashing');
  });
  finder.on('file-processed', ({ current, total }) => progress(current, total, 'Hashing'));
  finder.on('duplicates-found', printDuplicates);
  await finder.find(directory);
}

async function runOrganize(directory, output) {
  const organizer = new Organizer();
  organizer.on('organize-start', ({ directory, target, total }) => {
    console.log(`Organizing: ${directory}\nTarget: ${target}`);
    progress(0, total, 'Copying');
  });
  organizer.on('copy-complete', ({ current, total }) => progress(current, total, 'Copying'));
  organizer.on('organize-complete', printOrganization);
  await organizer.organize(directory, output);
}

async function runCleanup(directory, options) {
  const cleanup = new Cleanup();
  cleanup.on('file-found', printCleanupFile);
  cleanup.on('cleanup-preview', printCleanupPreview);
  cleanup.on('file-deleted', ({ current, total }) => progress(current, total, 'Deleting'));
  cleanup.on('cleanup-complete', printCleanupResult);
  await cleanup.run(directory, options);
}

async function main(args) {
  const options = parseArguments(args);
  switch (options.command) {
    case 'help':
      console.log(help);
      break;
    case 'version':
      console.log('1.0.0');
      break;
    case 'scan':
      await runScan(options.directory);
      break;
    case 'duplicates':
      await runDuplicates(options.directory);
      break;
    case 'organize':
      await runOrganize(options.directory, options.output);
      break;
    case 'cleanup':
      await runCleanup(options.directory, {
        olderThan: options.olderThan,
        confirm: options.confirm,
      });
      break;
  }
}

try {
  // Awaiting the command here catches both filesystem and stream failures.
  await main(process.argv.slice(2));
} catch (error) {
  console.error(`Error: ${formatError(error)}`);
  process.exitCode = 1;
}
