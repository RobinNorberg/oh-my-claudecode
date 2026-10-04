import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('contained-fs npm packaging (regression test for #4217)', () => {
  it('should have build:contained-fs script defined', () => {
    const packageJsonPath = resolve('package.json');
    expect(existsSync(packageJsonPath)).toBe(true);
    
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    expect(packageJson.scripts).toBeDefined();
    expect(packageJson.scripts['build:contained-fs']).toBeDefined();
    expect(packageJson.scripts['build:contained-fs']).toContain('build-contained-fs.mjs');
  });

  it('should have postinstall hook defined', () => {
    const packageJsonPath = resolve('package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    
    expect(packageJson.scripts).toBeDefined();
    expect(packageJson.scripts.postinstall).toBeDefined();
    expect(packageJson.scripts.postinstall).toContain('postinstall-contained-fs.mjs');
  });

  it('should include native scripts in files array', () => {
    const packageJsonPath = resolve('package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    
    expect(packageJson.files).toBeDefined();
    // These files must be included in the npm package
    expect(packageJson.files).toContain('scripts/build-contained-fs.mjs');
    expect(packageJson.files).toContain('scripts/postinstall-contained-fs.mjs');
    expect(packageJson.files).toContain('scripts/verify-graph-contained-fs.mjs');
    expect(packageJson.files).toContain('native');
  });

  it('should have build-contained-fs.mjs script file', () => {
    const scriptPath = resolve('scripts/build-contained-fs.mjs');
    expect(existsSync(scriptPath)).toBe(true);
    
    const content = readFileSync(scriptPath, 'utf-8');
    // Must support --optional flag for postinstall
    expect(content).toContain('--optional');
    // Must fail loudly when headers are missing (non-optional)
    expect(content).toContain('throw new Error');
  });

  it('should have postinstall-contained-fs.mjs wrapper script', () => {
    const scriptPath = resolve('scripts/postinstall-contained-fs.mjs');
    expect(existsSync(scriptPath)).toBe(true);
    
    const content = readFileSync(scriptPath, 'utf-8');
    // Must check for development environment
    expect(content).toContain('.git');
    // Must check if binary already exists
    expect(content).toContain('contained-fs');
    expect(content).toContain('.node');
  });

  it('should have verify-graph-contained-fs.mjs script for testing', () => {
    const scriptPath = resolve('scripts/verify-graph-contained-fs.mjs');
    expect(existsSync(scriptPath)).toBe(true);
  });

  it('should have native source file', () => {
    const nativePath = resolve('native/contained-fs.c');
    expect(existsSync(nativePath)).toBe(true);
    
    const content = readFileSync(nativePath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  });
});
