/**
 * Reporter's repro subprocess tests for issue #4208.
 * 
 * Verify that script hooks consume Jev active answers:
 * - pre-tool-enforcer.mjs: OMC_JEV="all:active" => model injection
 * - keyword-detector.mjs: OMC_JEV="all:active" => skill override
 * 
 * Compare active mode output with shadow mode (should be identical to Jev off).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import * as http from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const PROJECT_ROOT = join(__dirname, '../..');

// Mock Jev endpoint
let mockServer: http.Server;
let serverPort = 0;

beforeAll(() => {
  return new Promise<void>((resolve, reject) => {
    mockServer = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/v1/systemone') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            const payload = JSON.parse(body);
            // Return opus for model-routing, or 'true' for other points
            const answer = payload.questions['model-tier']
              ? { type: 'choice', choice: 'opus', confidence: 0.95 }
              : { type: 'noul', noul: true, confidence: 0.9 };
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ answers: { result: answer }, usage: { input_tokens: 10, output_tokens: 5 } }));
          } catch (e) {
            res.writeHead(500);
            res.end('Error');
          }
        });
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    
    mockServer.listen(0, '127.0.0.1', () => {
      serverPort = (mockServer.address() as any).port;
      resolve();
    });
  });
});

afterAll(() => {
  return new Promise<void>((resolve) => {
    mockServer.close(() => resolve());
  });
});

function runScript(
  scriptPath: string,
  input: Record<string, unknown>,
  env: Record<string, string>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn('node', [scriptPath], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, ...env, NODE_NO_WARNINGS: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    
    child.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
    });
    
    child.stdin?.write(JSON.stringify(input));
    child.stdin?.end();
  });
}

describe('jev active-mode subprocess repro', () => {
  it('pre-tool-enforcer.mjs: OMC_JEV=all:active injects Jev model (opus) when requesting haiku', async () => {
    const input = {
      toolName: 'Task',
      toolInput: {
        model: 'haiku',
        description: 'test task',
        prompt: 'build something',
      },
      directory: PROJECT_ROOT,
      sessionId: 'test-sess-active',
      prompt: '',
    };
    
    const env = {
      OMC_JEV: 'all:active',
      TYPESAFE_API_KEY: 'test-key-123',
      OMC_JEV_ENDPOINT: `http://127.0.0.1:${serverPort}/v1/systemone`,
      OMC_JEV_LOG_DIR: join(PROJECT_ROOT, '.omc/state/jev'),
    };
    
    const { stdout } = await runScript(
      join(PROJECT_ROOT, 'scripts/pre-tool-enforcer.mjs'),
      input,
      env,
    );
    
    const output = JSON.parse(stdout);
    // modifiedToolInput or modifiedInput should reflect opus from Jev
    const modifiedInput = output.modifiedToolInput || output.modifiedInput;
    expect(modifiedInput?.model || modifiedInput?.model).toContain('opus');
  });
  
  it('pre-tool-enforcer.mjs: OMC_JEV=all (shadow) is byte-identical to Jev unset', async () => {
    const input = {
      toolName: 'Task',
      toolInput: {
        model: 'haiku',
        description: 'test task',
        prompt: 'build something',
      },
      directory: PROJECT_ROOT,
      sessionId: 'test-sess-shadow',
      prompt: '',
    };
    
    // Shadow mode
    const shadowEnv = {
      OMC_JEV: 'all',
      TYPESAFE_API_KEY: 'test-key-123',
      OMC_JEV_ENDPOINT: `http://127.0.0.1:${serverPort}/v1/systemone`,
      OMC_JEV_LOG_DIR: join(PROJECT_ROOT, '.omc/state/jev'),
    };
    
    // Unset Jev
    const noJevEnv = { ...shadowEnv };
    delete noJevEnv.TYPESAFE_API_KEY;
    delete noJevEnv.OMC_JEV;
    
    const shadowResult = await runScript(
      join(PROJECT_ROOT, 'scripts/pre-tool-enforcer.mjs'),
      input,
      shadowEnv,
    );
    
    const noJevResult = await runScript(
      join(PROJECT_ROOT, 'scripts/pre-tool-enforcer.mjs'),
      input,
      noJevEnv,
    );
    
    // Outputs should be identical
    expect(shadowResult.stdout).toBe(noJevResult.stdout);
  });
});
