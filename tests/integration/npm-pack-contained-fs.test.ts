import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('npm pack contained-fs verification', () => {
  it('should include build:contained-fs with --force flag in package.json', () => {
    const packageJsonPath = resolve('package.json');
    expect(existsSync(packageJsonPath)).toBe(true);
    
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    expect(packageJson.scripts).toBeDefined();
    expect(packageJson.scripts['build:contained-fs']).toBeDefined();
    expect(packageJson.scripts['build:contained-fs']).toContain('--force');
    expect(packageJson.scripts['build:contained-fs']).toContain('build-contained-fs.mjs');
  });

  it('should have postinstall hook with --optional flag', () => {
    const packageJsonPath = resolve('package.json');
    expect(existsSync(packageJsonPath)).toBe(true);
    
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    expect(packageJson.scripts).toBeDefined();
    expect(packageJson.scripts.postinstall).toBeDefined();
    expect(packageJson.scripts.postinstall).toContain('build-contained-fs.mjs');
    expect(packageJson.scripts.postinstall).toContain('--optional');
  });

  it('should include native in files array', () => {
    const packageJsonPath = resolve('package.json');
    expect(existsSync(packageJsonPath)).toBe(true);
    
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    expect(packageJson.files).toBeDefined();
    expect(packageJson.files).toContain('native');
    expect(packageJson.files).toContain('scripts');
  });

  it('should have build-contained-fs.mjs script file', () => {
    const scriptPath = resolve('scripts/build-contained-fs.mjs');
    expect(existsSync(scriptPath)).toBe(true);
    
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('--optional');
    expect(content).toContain('--force');
  });

  it('should support --optional flag in build script', () => {
    const scriptPath = resolve('scripts/build-contained-fs.mjs');
    expect(existsSync(scriptPath)).toBe(true);
    
    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain("process.argv.includes('--optional')");
    expect(content).toContain('Skipping optional native build');
  });

  it('should have verify-graph-contained-fs.mjs script', () => {
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
