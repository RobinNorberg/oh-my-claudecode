#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Postinstall hook for contained-fs native build.
// Only run if:
// 1. Not already in the source repository (skip in dev installs)
// 2. The native binary doesn't already exist
// 3. We're in a real package installation

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Check if we're in development (check for .git means we're in the source repo)
const isSourceRepo = existsSync(resolve(root, '.git'));
if (isSourceRepo) {
  // Skip postinstall in development environments
  process.exit(0);
}

// Check if native binary already exists for current platform
const nativeBinary = resolve(root, 'native', `contained-fs-${process.platform}-${process.arch}.node`);
if (existsSync(nativeBinary)) {
  // Already built, skip
  process.exit(0);
}

// Run the optional build by spawning the script with --optional flag
const buildScript = resolve(dirname(fileURLToPath(import.meta.url)), 'build-contained-fs.mjs');
const result = spawnSync(process.execPath, [buildScript, '--optional'], { stdio: 'inherit' });

if (result.error) {
  console.error('Warning: Failed to build optional native module:', result.error.message);
}

process.exit(0);
