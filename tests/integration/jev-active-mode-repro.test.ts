/**
 * Reporter's repro subprocess tests for issue #4208.
 * 
 * Verify that script hooks handle Jev active mode correctly:
 * - pre-tool-enforcer.mjs: OMC_JEV="all:active" with unavailable endpoint gracefully degrades
 * - Shadow mode output is identical to Jev off for non-blocking points
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const PROJECT_ROOT = join(__dirname, '../..');

function runScript(
  scriptPath: string,
  input: Record<string, unknown>,
  env: Record<string, string>,
): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync('node', [scriptPath], {
    cwd: PROJECT_ROOT,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000,
  });
  
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.status ?? 1,
  };
}

describe('jev active-mode subprocess repro', () => {
  it('pre-tool-enforcer.mjs: OMC_JEV=all:active gracefully degrades when Jev unavailable', () => {
    const input = {
      toolName: 'Task',
      toolInput: {
        model: 'haiku',
        description: 'test task',
        prompt: 'build something',
      },
      directory: PROJECT_ROOT,
      sessionId: 'test-sess-active-' + Date.now(),
      prompt: '',
    };
    
    const env = {
      OMC_JEV: 'all:active',
      TYPESAFE_API_KEY: 'test-key-123',
      OMC_JEV_ENDPOINT: 'http://localhost:19999/unreachable',
      OMC_JEV_QUIET: '1',
      OMC_PRE_TOOL_ADVISORY_COOLDOWN_MS: '0',
    };
    
    const result = runScript(
      join(PROJECT_ROOT, 'scripts/pre-tool-enforcer.mjs'),
      input,
      env,
    );
    
    // Should exit cleanly even though Jev is unreachable (degrade-never-block)
    expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.continue).toBe(true);
  });

  it('pre-tool-enforcer.mjs: OMC_JEV=all (shadow) output is identical to Jev unset', () => {
    const baseEnv = {
      OMC_JEV_QUIET: '1',
      OMC_PRE_TOOL_ADVISORY_COOLDOWN_MS: '0',
    };
    
    const input = {
      toolName: 'Read',
      tool_input: { path: '/tmp' },
      directory: PROJECT_ROOT,
      sessionId: 'test-sess-shadow-' + Date.now(),
      prompt: '',
    };
    
    // Shadow mode
    const shadowResult = runScript(
      join(PROJECT_ROOT, 'scripts/pre-tool-enforcer.mjs'),
      input,
      { ...baseEnv, OMC_JEV: 'all', TYPESAFE_API_KEY: 'test-key' },
    );
    
    // Jev off
    const noJevResult = runScript(
      join(PROJECT_ROOT, 'scripts/pre-tool-enforcer.mjs'),
      input,
      baseEnv,
    );
    
    // Outputs should be identical when non-blocking point in shadow mode
    expect(shadowResult.stdout).toBe(noJevResult.stdout);
  });
});
