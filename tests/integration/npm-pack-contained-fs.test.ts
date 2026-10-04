import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { mkdtempSync, tmpdir } from 'node:os';

describe('npm pack contained-fs verification', () => {
  let tempDir: string;
  let tarballPath: string;

  beforeAll(() => {
    // Create a temporary directory for testing
    tempDir = mkdtempSync(join(tmpdir(), 'npm-pack-test-'));
    
    try {
      // Build the project
      console.log('Building project...');
      execSync('npm run build', { stdio: 'inherit', cwd: resolve('.') });

      // Create tarball
      console.log('Creating tarball...');
      const output = execSync('npm pack --pack-destination ' + tempDir, {
        cwd: resolve('.'),
        encoding: 'utf-8',
      }).trim();
      
      tarballPath = join(tempDir, output.split('\n').pop()?.trim() ?? '');
      expect(existsSync(tarballPath)).toBe(true);
      console.log('Tarball created at:', tarballPath);
    } catch (error) {
      console.error('Setup failed:', error);
      if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
      throw error;
    }
  });

  afterAll(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should include verify-graph-contained-fs script in tarball', () => {
    expect(tarballPath).toBeTruthy();
    
    // Check if the verify script is in the tarball
    const listOutput = execSync(`tar -tzf ${tarballPath}`, { encoding: 'utf-8' });
    expect(listOutput).toContain('package/scripts/verify-graph-contained-fs.mjs');
  });

  it('should include native source file in tarball', () => {
    expect(tarballPath).toBeTruthy();
    
    // Check if the C source is in the tarball
    const listOutput = execSync(`tar -tzf ${tarballPath}`, { encoding: 'utf-8' });
    expect(listOutput).toContain('package/native/contained-fs.c');
  });

  it('should include build script in tarball', () => {
    expect(tarballPath).toBeTruthy();
    
    // Check if the build script is in the tarball
    const listOutput = execSync(`tar -tzf ${tarballPath}`, { encoding: 'utf-8' });
    expect(listOutput).toContain('package/scripts/build-contained-fs.mjs');
  });

  it('should have postinstall hook in packaged package.json', () => {
    expect(tarballPath).toBeTruthy();
    
    // Extract and check package.json
    const packageJson = execSync(
      `tar -xzOf ${tarballPath} package/package.json`,
      { encoding: 'utf-8' }
    );
    
    const pkg = JSON.parse(packageJson);
    expect(pkg.scripts).toBeDefined();
    expect(pkg.scripts.postinstall).toBeDefined();
    expect(pkg.scripts.postinstall).toContain('build-contained-fs.mjs');
    expect(pkg.scripts.postinstall).toContain('--optional');
  });

  it('should have build:contained-fs with --force flag', () => {
    expect(tarballPath).toBeTruthy();
    
    // Extract and check package.json
    const packageJson = execSync(
      `tar -xzOf ${tarballPath} package/package.json`,
      { encoding: 'utf-8' }
    );
    
    const pkg = JSON.parse(packageJson);
    expect(pkg.scripts).toBeDefined();
    expect(pkg.scripts['build:contained-fs']).toBeDefined();
    expect(pkg.scripts['build:contained-fs']).toContain('--force');
  });
});
