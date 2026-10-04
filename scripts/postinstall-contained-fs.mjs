#!/usr/bin/env node
/**
 * Optional postinstall hook for contained-fs native module.
 * 
 * Follows the same platform constraints as build-contained-fs.mjs:
 * - darwin: always attempt to build
 * - linux: skip gracefully (not built by default)
 * - other: skip gracefully
 * 
 * Also skips in development environments (when .git exists).
 */

import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Determine package root
const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, '..');

// Skip if we're in development (source repo has .git)
if (existsSync(resolve(packageRoot, '.git'))) {
  process.exit(0);
}

// Skip on non-darwin platforms (consistent with build script default)
if (process.platform !== 'darwin') {
  process.exit(0);
}

// Check if native binary already exists for darwin
const nativePath = `contained-fs-${process.platform}-${process.arch}.node`;
const nativeBinary = resolve(packageRoot, 'native', nativePath);
if (existsSync(nativeBinary)) {
  process.exit(0);
}

// Attempt to build the optional native module on darwin
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
