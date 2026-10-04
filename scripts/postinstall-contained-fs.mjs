#!/usr/bin/env node
/**
 * Optional postinstall hook for contained-fs native module.
 * 
 * This script safely attempts to build the native module when a package is installed.
 * It gracefully skips if:
 * - Already in development/source repository
 * - Native binary already exists
 * - Build tools not available
 * 
 * This never fails the npm install - it only logs warnings.
 */

import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

try {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  // Skip if we're in the source repository (check for .git)
  if (existsSync(resolve(root, '.git'))) {
    process.exit(0);
  }

  // Skip if native binary already exists for current platform
  const nativeBinary = resolve(root, 'native', `contained-fs-${process.platform}-${process.arch}.node`);
  if (existsSync(nativeBinary)) {
    process.exit(0);
  }

  // Try to build the native module (with --optional to skip gracefully if headers missing)
  const buildScript = resolve(dirname(fileURLToPath(import.meta.url)), 'build-contained-fs.mjs');
  if (!existsSync(buildScript)) {
    // Build script not found, skip silently
    process.exit(0);
  }

  const result = spawnSync(process.execPath, [buildScript, '--optional'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60000, // 60 second timeout for build
  });

  // Never fail postinstall - just log the result
  if (result.error) {
    // Silent skip on error
    process.exit(0);
  }

  process.exit(0);
} catch (error) {
  // Catch any unexpected errors and exit silently
  // Postinstall should never fail the installation
  process.exit(0);
}
