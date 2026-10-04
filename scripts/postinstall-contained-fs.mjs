#!/usr/bin/env node
/**
 * Optional postinstall hook for contained-fs native module.
 * 
 * This script is a no-op in development environments (when .git exists)
 * to avoid breaking npm install/ci workflows.
 * 
 * When installed as a dependency (no .git), it will attempt to build
 * the native module if needed.
 */

import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Determine package root
const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, '..');

// Check if we're in development (source repo has .git)
const isSourceRepo = existsSync(resolve(packageRoot, '.git'));
if (isSourceRepo) {
  // Skip in development environment
  process.exit(0);
}

// Check if native binary already exists
const nativePath = `contained-fs-${process.platform}-${process.arch}.node`;
const nativeBinary = resolve(packageRoot, 'native', nativePath);
if (existsSync(nativeBinary)) {
  // Already built
  process.exit(0);
}

// Attempt to build the optional native module
try {
  const buildScript = resolve(scriptDir, 'build-contained-fs.mjs');
  spawnSync(process.execPath, [buildScript, '--optional'], {
    stdio: 'ignore',
    timeout: 120000,
  });
} catch {
  // Silently ignore any errors - postinstall should never fail
}

process.exit(0);
