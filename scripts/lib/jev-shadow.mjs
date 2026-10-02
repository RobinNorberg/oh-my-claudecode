import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Mirror the resolver's key, master-off, point, wildcard, and :active gates.
 * Returns 'off' | 'shadow' | 'active'.
 */
export function isJevShadowOptedIn(point, env = process.env) {
  const raw = (env.OMC_JEV || '').trim();
  if (!env.TYPESAFE_API_KEY || raw === 'off') return 'off';

  for (const entry of raw.split(',')) {
    const token = entry.trim();
    if (!token) continue;
    const colon = token.lastIndexOf(':');
    const name = colon === -1 ? token : token.slice(0, colon);
    const isActive = colon !== -1 && token.slice(colon + 1) === 'active';
    if (name === 'all' || name === point) {
      return isActive ? 'active' : 'shadow';
    }
  }
  return 'off';
}

/**
 * Fire-and-record one script-side judgment without affecting its caller.
 * Returns immediately (fire-and-forget for shadow, or active result for active mode).
 */
export function recordJevShadow({ point, state, questions, heuristic }) {
  const mode = isJevShadowOptedIn(point);
  if (mode === 'off') return undefined;

  try {
    const requestFile = join(mkdtempSync(join(tmpdir(), 'omc-jev-')), 'request.json');
    writeFileSync(requestFile, JSON.stringify({ point, state, questions, heuristic }), {
      encoding: 'utf8',
      mode: 0o600,
    });
    
    if (mode === 'shadow') {
      // Fire-and-forget for shadow mode
      const child = spawn(process.execPath, [
        fileURLToPath(new URL('../jev-resolve.mjs', import.meta.url)),
        '--request-file',
        requestFile,
      ], {
        stdio: ['ignore', 'ignore', 'ignore'],
        env: process.env,
      });
      child.on('error', () => {});
      child.unref();
      return undefined;
    }
    
    // Active mode: spawn synchronously and read result
    if (mode === 'active') {
      const result = spawnSync(process.execPath, [
        fileURLToPath(new URL('../jev-resolve.mjs', import.meta.url)),
        '--request-file',
        requestFile,
      ], {
        stdio: ['ignore', 'pipe', 'ignore'],
        env: process.env,
        encoding: 'utf8',
        timeout: (parseInt(process.env.OMC_JEV_TIMEOUT_MS || '2000', 10) || 2000) + 500, // Add buffer
      });
      
      if (result.status === 0 && result.stdout) {
        try {
          return JSON.parse(result.stdout);
        } catch {
          // Parse error: fall back to heuristic
          return undefined;
        }
      }
    }
  } catch {
    // Jev logging is advisory; temp-file or spawn failures never affect hooks.
  }
  return undefined;
}
